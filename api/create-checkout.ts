import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const handlePattern = /^[a-z0-9._]{2,24}$/;

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

function feeCents(amountCents: number): number {
  return Math.round(amountCents * 0.029 + 30);
}

function receiptRef(): string {
  const n = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, "0");
  return `PAY-${n}`;
}

function siteOrigin(req: VercelRequest): string {
  const fromEnv = process.env.SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  if (host) return `${proto}://${host}`;
  return "https://paymyhandle.com";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return res.status(503).json({
      error: "Stripe is not configured. Add STRIPE_SECRET_KEY in Vercel env.",
    });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const handle = normalizeHandle(String(body?.handle ?? ""));
  const note = String(body?.note ?? "").trim().slice(0, 80);
  const from = String(body?.from ?? "").trim().slice(0, 32) || "Someone";
  const amount = Number(body?.amount);

  if (!handlePattern.test(handle)) {
    return res.status(400).json({ error: "Invalid TikTok handle." });
  }
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    return res.status(400).json({ error: "Amount must be between €1 and €500." });
  }

  const amountCents = Math.round(amount * 100);
  const fee = feeCents(amountCents);
  const ref = receiptRef();
  const origin = siteOrigin(req);
  const stripe = new Stripe(secret);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: amountCents,
            product_data: {
              name: `Pay @${handle}`,
              description: note || `Held for TikTok @${handle} on paymyhandle.com`,
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: fee,
            product_data: {
              name: "Card fee",
              description: "2.9% + €0.30",
            },
          },
        },
      ],
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?cancel=1&handle=${encodeURIComponent(handle)}`,
      metadata: {
        handle,
        note,
        from,
        ref,
        amount: amount.toFixed(2),
      },
      payment_intent_data: {
        metadata: {
          handle,
          note,
          from,
          ref,
        },
      },
    });

    if (!session.url) {
      return res.status(500).json({ error: "Stripe did not return a checkout URL." });
    }

    return res.status(200).json({ url: session.url, ref });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return res.status(500).json({ error: message });
  }
}
