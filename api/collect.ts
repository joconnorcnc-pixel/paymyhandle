import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  findConnectAccount,
  getStripe,
  handlePattern,
  isConnectReady,
  isExpired,
  normalizeHandle,
  parseBody,
  paymentIntentId,
  retrieveConnectAccount,
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
    const confirmed = Boolean(body.confirmed);
    const verifyCode = String(body.verify_code ?? "").trim().toUpperCase();

    if (!handlePattern.test(handle)) {
      return res.status(400).json({ error: "Invalid TikTok handle." });
    }
    if (!sessionId.startsWith("cs_")) {
      return res.status(400).json({ error: "Missing session_id." });
    }
    if (!confirmed) {
      return res.status(400).json({ error: "Confirm you own this TikTok handle." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(402).json({ error: "Payment not completed." });
    }

    const meta = session.metadata ?? {};
    const metaHandle = normalizeHandle(String(meta.handle ?? ""));
    const amount = Number(meta.amount);
    const ref = String(meta.ref || session.id);
    if (metaHandle !== handle) {
      return res.status(403).json({ error: "Handle does not match this payment." });
    }
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(500).json({ error: "Invalid payment amount." });
    }

    const expectedCode = `PMH-${ref.replace(/^PAY-/, "").slice(0, 6)}`;
    if (verifyCode !== expectedCode) {
      return res.status(400).json({
        error: `Enter the code ${expectedCode} (also put it in your TikTok bio).`,
      });
    }

    if (meta.collected === "true" || meta.transfer_id) {
      return res.status(200).json({
        ok: true,
        already: true,
        transferId: meta.transfer_id,
        amount,
      });
    }

    const piId = await paymentIntentId(session);
    if (!piId) {
      return res.status(500).json({ error: "No payment intent on this session." });
    }

    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.collected === "true") {
      return res.status(200).json({
        ok: true,
        already: true,
        transferId: pi.metadata.transfer_id,
        amount,
      });
    }

    if (meta.refunded === "true" || pi.metadata?.refunded === "true") {
      return res.status(410).json({ error: "This payment was refunded." });
    }

    if (isExpired(session.created)) {
      await stripe.refunds.create({
        payment_intent: piId,
        reason: "requested_by_customer",
        metadata: { reason: "unclaimed_30_days", handle, ref },
      });
      await stripe.paymentIntents.update(piId, {
        metadata: { ...pi.metadata, refunded: "true" },
      });
      await stripe.checkout.sessions.update(sessionId, {
        metadata: { ...meta, refunded: "true" },
      });
      return res.status(410).json({
        error: "Unclaimed for 30 days — refunded to the payer.",
        refunded: true,
      });
    }

    const account =
      (meta.connect_account_id
        ? await retrieveConnectAccount(stripe, meta.connect_account_id).catch(() => null)
        : null) ?? (await findConnectAccount(stripe, handle));
    if (!account || !isConnectReady(account)) {
      return res.status(400).json({
        error: "Connect your bank with Stripe first, then collect.",
      });
    }

    const amountCents = Math.round(amount * 100);
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "eur",
      destination: account.id,
      transfer_group: ref,
      metadata: { handle, ref, session_id: sessionId },
    });

    await stripe.paymentIntents.update(piId, {
      metadata: {
        ...pi.metadata,
        collected: "true",
        transfer_id: transfer.id,
        collected_at: new Date().toISOString(),
      },
    });
    await stripe.checkout.sessions.update(sessionId, {
      metadata: {
        ...meta,
        collected: "true",
        transfer_id: transfer.id,
      },
    });

    return res.status(200).json({
      ok: true,
      transferId: transfer.id,
      amount,
      destination: account.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Collect failed";
    return res.status(500).json({ error: message });
  }
}
