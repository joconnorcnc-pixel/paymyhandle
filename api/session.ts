import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return res.status(503).json({ error: "Stripe is not configured." });
  }

  const sessionId = String(req.query.session_id ?? "");
  if (!sessionId.startsWith("cs_")) {
    return res.status(400).json({ error: "Missing or invalid session_id." });
  }

  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(402).json({ error: "Payment not completed.", payment_status: session.payment_status });
    }

    const meta = session.metadata ?? {};
    const amount = Number(meta.amount);
    if (!meta.handle || !Number.isFinite(amount)) {
      return res.status(500).json({ error: "Session missing payment metadata." });
    }

    return res.status(200).json({
      handle: meta.handle,
      amount,
      note: meta.note ?? "",
      from: meta.from || "Someone",
      ref: meta.ref || session.id,
      sessionId: session.id,
      livemode: session.livemode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load session";
    return res.status(500).json({ error: message });
  }
}
