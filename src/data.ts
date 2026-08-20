export type Creator = {
  handle: string;
  name: string;
  bio: string;
  followers: string;
  verified: boolean;
  accent: string;
};

export const amounts = [5, 10, 20, 50] as const;

export const creators: Creator[] = [
  {
    handle: "nosh.ie",
    name: "Nosh",
    bio: "Dublin eats in 20 seconds. Tips go to the next stall run.",
    followers: "412k",
    verified: true,
    accent: "#c8f542",
  },
  {
    handle: "aoife.runs",
    name: "Aoife Byrne",
    bio: "Marathon clips, early miles, and the odd pint after.",
    followers: "88.4k",
    verified: false,
    accent: "#7ee0c5",
  },
  {
    handle: "garage.tunes",
    name: "Garage Tunes",
    bio: "Late sets from a shed in Cork. Pay if a track saved your night.",
    followers: "1.2m",
    verified: true,
    accent: "#ffb4a2",
  },
  {
    handle: "tiny.garden",
    name: "Maeve",
    bio: "Balcony plants and the ones I should not have bought.",
    followers: "56.1k",
    verified: false,
    accent: "#d4b8ff",
  },
];

const handlePattern = /^[a-z0-9._]{2,24}$/;

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return handlePattern.test(handle);
}

export function creatorFor(handle: string): Creator {
  const found = creators.find((item) => item.handle === handle);
  if (found) return found;
  return {
    handle,
    name: handle,
    bio: "They collect when you paste the link in their TikTok DMs.",
    followers: "—",
    verified: false,
    accent: accentFor(handle),
  };
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function feeFor(amount: number): number {
  return Math.round((amount * 0.029 + 0.3) * 100) / 100;
}

export function receiptRef(): string {
  const n = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, "0");
  return `PAY-${n}`;
}

export function tiktokUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle}`;
}

export function siteOrigin(): string {
  const fromEnv = import.meta.env.VITE_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.PROD) return "https://paymyhandle.com";
  return window.location.origin;
}

export function claimUrl(
  handle: string,
  ref: string,
  amount: number,
  sessionId: string,
): string {
  return `${siteOrigin()}/#claim/${handle}/${ref}/${Math.round(amount * 100)}/${sessionId}`;
}

export function dmMessage(opts: {
  from: string;
  amount: number;
  note: string;
  handle: string;
  ref: string;
  sessionId: string;
}): string {
  const money = formatMoney(opts.amount);
  const note = opts.note ? ` “${opts.note}”` : "";
  return `${opts.from} sent you ${money} on paymyhandle.com.${note} Collect it here: ${claimUrl(opts.handle, opts.ref, opts.amount, opts.sessionId)}`;
}

export type ClaimLink = {
  handle: string;
  ref: string;
  amount: number;
  sessionId: string;
};

export function parseClaimHash(hash: string): ClaimLink | null {
  const match = hash.match(
    /^#claim\/([a-z0-9._]{2,24})\/([A-Z0-9-]+)\/(\d+)\/(cs_[A-Za-z0-9]+)$/i,
  );
  if (!match) return null;
  const amount = Number(match[3]) / 100;
  if (!Number.isFinite(amount) || amount < 1) return null;
  return {
    handle: normalizeHandle(match[1]),
    ref: match[2].toUpperCase(),
    amount,
    sessionId: match[4],
  };
}

function accentFor(handle: string): string {
  const palette = ["#c8f542", "#7ee0c5", "#ffb4a2", "#d4b8ff", "#f5d76e", "#9ad0ff"];
  let hash = 0;
  for (const char of handle) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
