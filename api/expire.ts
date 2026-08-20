import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getStripe,
  isExpired,
  paymentIntentId,
} from "./lib/stripe.js";

/** Refund paid-but-unclaimed sessions older than 30 days. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const stripe = getStripe();
    const sessionId = String(
      (typeof req.body === "object" && req.body && "session_id" in req.body
        ? (req.body as { session_id?: string }).session_id
        : null) ?? req.query.session_id ?? "",
    );

    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ error: "Missing session_id." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Not a paid session." });
    }

    const meta = session.metadata ?? {};
    if (meta.collected === "true") {
      return res.status(400).json({ error: "Already collected." });
    }
    if (meta.refunded === "true") {
      return res.status(200).json({ ok: true, already: true });
    }
    if (!isExpired(session.created)) {
      return res.status(400).json({ error: "Still within the 30-day hold." });
    }

    const piId = await paymentIntentId(session);
    if (!piId) return res.status(500).json({ error: "No payment intent." });

    const refund = await stripe.refunds.create({
      payment_intent: piId,
      reason: "requested_by_customer",
      metadata: { reason: "unclaimed_30_days", ref: meta.ref ?? "" },
    });

    const pi = await stripe.paymentIntents.retrieve(piId);
    await stripe.paymentIntents.update(piId, {
      metadata: { ...pi.metadata, refunded: "true" },
    });
    await stripe.checkout.sessions.update(sessionId, {
      metadata: { ...meta, refunded: "true" },
    });

    return res.status(200).json({ ok: true, refundId: refund.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refund failed";
    return res.status(500).json({ error: message });
  }
}
