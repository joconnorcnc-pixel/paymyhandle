import type { VercelRequest } from "@vercel/node";
import Stripe from "stripe";

export const HOLD_DAYS = 30;
export const handlePattern = /^[a-z0-9._]{2,24}$/;

export function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(secret);
}

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function siteOrigin(req: VercelRequest): string {
  const fromEnv = process.env.SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  if (host) return `${proto}://${host}`;
  return "https://paymyhandle.com";
}

export function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return req.body as Record<string, unknown>;
}

export function verifyCodeFor(ref: string): string {
  return `PMH-${ref.replace(/^PAY-/, "").slice(0, 6)}`;
}

export async function findConnectAccount(
  stripe: Stripe,
  handle: string,
): Promise<Stripe.Account | null> {
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const list = await stripe.accounts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const found = list.data.find((account) => account.metadata?.handle === handle);
    if (found) return found;
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]?.id;
  }
  return null;
}

export function isExpired(createdUnix: number, now = Date.now()): boolean {
  return now - createdUnix * 1000 > HOLD_DAYS * 24 * 60 * 60 * 1000;
}

export async function paymentIntentId(
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  const pi = session.payment_intent;
  if (!pi) return null;
  if (typeof pi === "string") return pi;
  return pi.id;
}
