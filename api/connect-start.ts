import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createRecipientAccount,
  findConnectAccount,
  getStripe,
  handlePattern,
  isConnectReady,
  normalizeHandle,
  parseBody,
  retrieveConnectAccount,
  siteOrigin,
} from "./lib/stripe.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const stripe = getStripe();
    const body = parseBody(req);
    const handle = normalizeHandle(String(body.handle ?? ""));
    const sessionId = String(body.session_id ?? "");
    const country = String(body.country ?? "IE").toUpperCase().slice(0, 2);
    const contactEmail = String(body.email ?? "").trim().toLowerCase();

    if (!handlePattern.test(handle)) {
      return res.status(400).json({ error: "Invalid TikTok handle." });
    }
    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ error: "Missing session_id." });
    }
    if (!/^[A-Z]{2}$/.test(country)) {
      return res.status(400).json({ error: "Invalid country code." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ error: "Enter a valid email for Stripe." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const meta = session.metadata ?? {};
    const metaHandle = normalizeHandle(String(meta.handle ?? ""));
    if (metaHandle !== handle) {
      return res.status(403).json({ error: "Handle does not match this payment." });
    }

    let account =
      (meta.connect_account_id
        ? await retrieveConnectAccount(stripe, meta.connect_account_id).catch(() => null)
        : null) ?? (await findConnectAccount(stripe, handle));

    if (!account) {
      account = await createRecipientAccount(stripe, {
        handle,
        country,
        contactEmail,
      });
    }

    if (meta.connect_account_id !== account.id) {
      await stripe.checkout.sessions.update(sessionId, {
        metadata: { ...meta, connect_account_id: account.id },
      });
    }

    const ready = isConnectReady(account);
    if (ready) {
      return res.status(200).json({
        url: null,
        accountId: account.id,
        ready: true,
      });
    }

    // Stripe rejects return_url / refresh_url that include #hash fragments.
    const origin = siteOrigin(req);
    const returnUrl = `${origin}/?collect=${encodeURIComponent(sessionId)}`;

    const accountLink = await stripe.v2.core.accountLinks.create({
      account: account.id,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          refresh_url: returnUrl,
          return_url: returnUrl,
          collection_options: {
            fields: "eventually_due",
          },
        },
      },
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: account.id,
      ready: false,
    });
  } catch (err) {
    const stripeErr = err as { message?: string; param?: string; code?: string };
    const message = stripeErr.message || "Connect onboarding failed";
    const detail = stripeErr.param ? `${message} (${stripeErr.param})` : message;
    return res.status(500).json({
      error: detail,
      param: stripeErr.param ?? null,
      code: stripeErr.code ?? null,
    });
  }
}
