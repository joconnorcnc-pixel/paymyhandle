import type { VercelRequest } from "@vercel/node";
import Stripe from "stripe";

export const HOLD_DAYS = 30;
export const handlePattern = /^[a-z0-9._]{2,24}$/;

export type ConnectAccount = Stripe.V2.Core.Account;

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

export async function retrieveConnectAccount(
  stripe: Stripe,
  accountId: string,
): Promise<ConnectAccount> {
  return stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient", "identity"],
  });
}

/** Ready to receive Transfers into the connected account's Stripe balance. */
export function isConnectReady(account: ConnectAccount | null | undefined): boolean {
  if (!account) return false;
  return (
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers
      ?.status === "active"
  );
}

export async function findConnectAccount(
  stripe: Stripe,
  handle: string,
): Promise<ConnectAccount | null> {
  const list = stripe.v2.core.accounts.list({
    limit: 20,
    applied_configurations: ["recipient"],
  });

  for await (const account of list) {
    if (account.metadata?.handle === handle) {
      return retrieveConnectAccount(stripe, account.id);
    }
  }
  return null;
}

export async function createRecipientAccount(
  stripe: Stripe,
  opts: { handle: string; country: string; contactEmail: string },
): Promise<ConnectAccount> {
  const displayName = `@${opts.handle}`;
  return stripe.v2.core.accounts.create({
    display_name: displayName,
    contact_email: opts.contactEmail,
    dashboard: "express",
    identity: {
      country: opts.country.toLowerCase(),
      entity_type: "individual",
    },
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
    metadata: { handle: opts.handle },
    include: ["configuration.recipient", "identity", "requirements"],
  });
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
