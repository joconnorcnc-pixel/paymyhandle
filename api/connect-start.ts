import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  findConnectAccount,
  getStripe,
  handlePattern,
  normalizeHandle,
  parseBody,
  siteOrigin,
} from "./lib/stripe";

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

    if (!handlePattern.test(handle)) {
      return res.status(400).json({ error: "Invalid TikTok handle." });
    }
    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ error: "Missing session_id." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metaHandle = normalizeHandle(String(session.metadata?.handle ?? ""));
    if (metaHandle !== handle) {
      return res.status(403).json({ error: "Handle does not match this payment." });
    }

    let account = await findConnectAccount(stripe, handle);
    if (!account) {
      account = await stripe.accounts.create({
        type: "express",
        country,
        email: undefined,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: "individual",
        metadata: { handle },
        settings: {
          payouts: {
            schedule: { interval: "daily" },
          },
        },
      });
    }

    const origin = siteOrigin(req);
    const returnHash = `claim/${handle}/${session.metadata?.ref ?? "PAY"}/${Math.round(Number(session.metadata?.amount ?? 0) * 100)}/${sessionId}`;
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/#${returnHash}`,
      return_url: `${origin}/#${returnHash}`,
      type: "account_onboarding",
    });

    return res.status(200).json({
      url: accountLink.url,
      accountId: account.id,
      ready: Boolean(account.charges_enabled && account.payouts_enabled),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connect onboarding failed";
    return res.status(500).json({ error: message });
  }
}
