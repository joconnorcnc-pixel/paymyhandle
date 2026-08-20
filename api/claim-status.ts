import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  findConnectAccount,
  getStripe,
  handlePattern,
  isExpired,
  normalizeHandle,
  paymentIntentId,
  verifyCodeFor,
} from "./lib/stripe";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const stripe = getStripe();
    const sessionId = String(req.query.session_id ?? "");
    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ error: "Missing or invalid session_id." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(402).json({
        error: "Payment not completed.",
        payment_status: session.payment_status,
      });
    }

    const meta = session.metadata ?? {};
    const handle = normalizeHandle(String(meta.handle ?? ""));
    const amount = Number(meta.amount);
    const ref = String(meta.ref || session.id);
    if (!handlePattern.test(handle) || !Number.isFinite(amount)) {
      return res.status(500).json({ error: "Session missing payment metadata." });
    }

    const piId = await paymentIntentId(stripe, session);
    let collected = meta.collected === "true";
    let transferId = meta.transfer_id || null;
    let refunded = meta.refunded === "true";

    if (piId) {
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.metadata?.collected === "true") collected = true;
      if (pi.metadata?.transfer_id) transferId = pi.metadata.transfer_id;
      if (pi.metadata?.refunded === "true") refunded = true;
    }

    const expired = isExpired(session.created);
    const account = await findConnectAccount(stripe, handle);
    const connectReady = Boolean(
      account && account.charges_enabled && account.payouts_enabled,
    );

    return res.status(200).json({
      handle,
      amount,
      note: meta.note ?? "",
      from: meta.from || "Someone",
      ref,
      sessionId: session.id,
      livemode: session.livemode,
      created: session.created,
      collected,
      transferId,
      refunded,
      expired,
      connectReady,
      connectAccountId: account?.id ?? null,
      verifyCode: verifyCodeFor(ref),
      holdDays: 30,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load claim";
    return res.status(500).json({ error: message });
  }
}
