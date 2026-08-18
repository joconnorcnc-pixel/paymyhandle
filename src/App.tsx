import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  amounts,
  claimUrl,
  creatorFor,
  creators,
  dmMessage,
  feeFor,
  formatMoney,
  isValidHandle,
  normalizeHandle,
  parseClaimHash,
  receiptRef,
  tiktokUrl,
  type ClaimLink,
  type Creator,
} from "./data";

type View = "home" | "pay" | "done" | "claim";

type Receipt = {
  creator: Creator;
  amount: number;
  note: string;
  from: string;
  ref: string;
};

const receiptKey = (ref: string) => `paymyhandle:receipt:${ref}`;
const receiptIndexKey = "paymyhandle:receipts";

function loadIndex(): string[] {
  try {
    const raw = localStorage.getItem(receiptIndexKey);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveReceipt(receipt: Receipt) {
  localStorage.setItem(receiptKey(receipt.ref), JSON.stringify(receipt));
  const index = loadIndex().filter((ref) => ref !== receipt.ref);
  index.unshift(receipt.ref);
  localStorage.setItem(receiptIndexKey, JSON.stringify(index.slice(0, 20)));
}

function loadReceipt(ref: string): Receipt | null {
  const raw = localStorage.getItem(receiptKey(ref));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Receipt;
  } catch {
    return null;
  }
}

function loadReceipts(): Receipt[] {
  return loadIndex()
    .map(loadReceipt)
    .filter((item): item is Receipt => item !== null);
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [draft, setDraft] = useState("");
  const [handle, setHandle] = useState("");
  const [amount, setAmount] = useState(10);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [from, setFrom] = useState("");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [claim, setClaim] = useState<ClaimLink | null>(null);
  const [sent, setSent] = useState<Receipt[]>(() => loadReceipts());

  const creator = useMemo(() => (handle ? creatorFor(handle) : null), [handle]);
  const known = creators.some((item) => item.handle === handle);
  const parsedCustom = Number(custom);
  const usingCustom = custom.trim() !== "" && Number.isFinite(parsedCustom);
  const payAmount = usingCustom ? parsedCustom : amount;
  const validAmount = payAmount >= 1 && payAmount <= 500;
  const fee = validAmount ? feeFor(payAmount) : 0;

  useEffect(() => {
    function syncHash() {
      const link = parseClaimHash(window.location.hash);
      if (!link) return;
      setClaim(link);
      setView("claim");
    }
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  function goPay(raw: string) {
    const next = normalizeHandle(raw);
    if (!isValidHandle(next)) {
      setError("Use 2–24 letters, numbers, dots, or underscores.");
      return;
    }
    setError("");
    setHandle(next);
    setDraft(next);
    setAmount(10);
    setCustom("");
    setNote("");
    setFrom("");
    setPaying(false);
    setView("pay");
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    goPay(draft);
  }

  function onPay() {
    if (!creator || !validAmount || paying) return;
    setPaying(true);
    window.setTimeout(() => {
      const next: Receipt = {
        creator,
        amount: payAmount,
        note: note.trim(),
        from: from.trim() || "Someone",
        ref: receiptRef(),
      };
      saveReceipt(next);
      setReceipt(next);
      setSent(loadReceipts());
      setPaying(false);
      setView("done");
    }, 1100);
  }

  function reset() {
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setView("home");
    setDraft("");
    setHandle("");
    setReceipt(null);
    setClaim(null);
    setError("");
  }

  function openClaim(next: Receipt) {
    window.location.hash = `claim/${next.creator.handle}/${next.ref}/${Math.round(next.amount * 100)}`;
  }

  return (
    <div className="shell">
      <header className="nav">
        <button className="mark" onClick={reset}>
          paymyhandle.com
        </button>
        <span className="nav-meta">
          {view === "claim" ? "Collect from a DM" : "Pay a TikTok handle"}
        </span>
      </header>

      {view === "home" && (
        <Home
          draft={draft}
          error={error}
          sent={sent}
          onDraft={setDraft}
          onSearch={onSearch}
          onPick={goPay}
          onOpenDm={(item) => {
            setReceipt(item);
            setView("done");
          }}
          onOpenClaim={openClaim}
        />
      )}

      {view === "pay" && creator && (
        <Pay
          creator={creator}
          known={known}
          amount={amount}
          custom={custom}
          note={note}
          from={from}
          payAmount={payAmount}
          validAmount={validAmount}
          fee={fee}
          paying={paying}
          onBack={() => setView("home")}
          onAmount={(value) => {
            setAmount(value);
            setCustom("");
          }}
          onCustom={setCustom}
          onNote={setNote}
          onFrom={setFrom}
          onPay={onPay}
        />
      )}

      {view === "done" && receipt && (
        <Done
          receipt={receipt}
          onAgain={reset}
          onPreview={() => openClaim(receipt)}
        />
      )}

      {view === "claim" && claim && (
        <Claim
          link={claim}
          stored={loadReceipt(claim.ref)}
          onHome={reset}
        />
      )}
    </div>
  );
}

function Home({
  draft,
  error,
  sent,
  onDraft,
  onSearch,
  onPick,
  onOpenDm,
  onOpenClaim,
}: {
  draft: string;
  error: string;
  sent: Receipt[];
  onDraft: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onPick: (handle: string) => void;
  onOpenDm: (receipt: Receipt) => void;
  onOpenClaim: (receipt: Receipt) => void;
}) {
  return (
    <main className="page">
      <section className="hero">
        <p className="kicker">For fans, not algorithms</p>
        <h1 className="headline">
          Pay any
          <br />
          <em>TikTok handle.</em>
        </h1>
        <p className="lede">
          Type an @, pay, then DM them the collect link. They tap it in TikTok
          and the money is theirs.
        </p>

        <form className="search" onSubmit={onSearch}>
          <label className="search-field">
            <span className="at">@</span>
            <input
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              placeholder="their.tiktok"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="TikTok handle"
            />
          </label>
          <button className="primary" type="submit">
            Continue
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {sent.length > 0 && (
        <section>
          <h2 className="section-label">Waiting on a DM</h2>
          <ul className="creator-grid">
            {sent.map((item) => (
              <li key={item.ref}>
                <div className="sent-card">
                  <button className="creator-card" onClick={() => onOpenDm(item)}>
                    <Avatar creator={item.creator} />
                    <span className="creator-copy">
                      <strong>
                        {formatMoney(item.amount)} → @{item.creator.handle}
                      </strong>
                      <span className="muted">{item.ref} · copy again</span>
                    </span>
                  </button>
                  <button className="text-link" onClick={() => onOpenClaim(item)}>
                    Collect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-label">Open handles</h2>
        <ul className="creator-grid">
          {creators.map((item) => (
            <li key={item.handle}>
              <button className="creator-card" onClick={() => onPick(item.handle)}>
                <Avatar creator={item} />
                <span className="creator-copy">
                  <strong>@{item.handle}</strong>
                  <span className="muted">
                    {item.name} · {item.followers}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="steps">
        <h2 className="section-label">How it works</h2>
        <ol className="step-list">
          <li>
            <strong>Find them</strong>
            <span>Use the same handle they use on TikTok.</span>
          </li>
          <li>
            <strong>Pay</strong>
            <span>Card payment, €1–€500. A short note is optional.</span>
          </li>
          <li>
            <strong>DM the link</strong>
            <span>Paste the collect message in their TikTok DMs. They tap it to get paid.</span>
          </li>
        </ol>
      </section>

      <footer className="foot">
        paymyhandle.com cannot send TikTok DMs for you. You paste the link. Demo
        checkout — no real charges.
      </footer>
    </main>
  );
}

function Pay({
  creator,
  known,
  amount,
  custom,
  note,
  from,
  payAmount,
  validAmount,
  fee,
  paying,
  onBack,
  onAmount,
  onCustom,
  onNote,
  onFrom,
  onPay,
}: {
  creator: Creator;
  known: boolean;
  amount: number;
  custom: string;
  note: string;
  from: string;
  payAmount: number;
  validAmount: boolean;
  fee: number;
  paying: boolean;
  onBack: () => void;
  onAmount: (value: number) => void;
  onCustom: (value: string) => void;
  onNote: (value: string) => void;
  onFrom: (value: string) => void;
  onPay: () => void;
}) {
  return (
    <main className="page pay-page">
      <button className="back" onClick={onBack}>
        All handles
      </button>

      <section className="profile">
        <Avatar creator={creator} large />
        <div>
          <p className="handle-line">
            @{creator.handle}
            {creator.verified && <span className="badge">Verified</span>}
            {!known && <span className="badge dim">New handle</span>}
          </p>
          <h1 className="profile-name">{creator.name}</h1>
          <p className="lede tight">{creator.bio}</p>
        </div>
      </section>

      <section className="pay-card">
        <h2 className="section-label">Amount</h2>
        <div className="chips">
          {amounts.map((value) => (
            <button
              key={value}
              className={`chip ${custom.trim() === "" && amount === value ? "is-on" : ""}`}
              onClick={() => onAmount(value)}
              type="button"
            >
              {formatMoney(value)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Or custom</span>
          <input
            inputMode="decimal"
            placeholder="25"
            value={custom}
            onChange={(event) => onCustom(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Note</span>
          <input
            maxLength={80}
            placeholder="Loved the chipper video"
            value={note}
            onChange={(event) => onNote(event.target.value)}
          />
        </label>
        <label className="field">
          <span>From</span>
          <input
            maxLength={32}
            placeholder="Your name, or leave blank"
            value={from}
            onChange={(event) => onFrom(event.target.value)}
          />
        </label>

        <div className="totals">
          <p>
            <span>They receive</span>
            <strong>{validAmount ? formatMoney(payAmount) : "—"}</strong>
          </p>
          <p>
            <span>Card fee</span>
            <span>{validAmount ? formatMoney(fee) : "—"}</span>
          </p>
          <p className="due">
            <span>You pay</span>
            <strong>{validAmount ? formatMoney(payAmount + fee) : "—"}</strong>
          </p>
        </div>

        {!validAmount && (
          <p className="error">Enter an amount between €1 and €500.</p>
        )}

        <button className="primary" disabled={!validAmount || paying} onClick={onPay}>
          {paying ? "Sending…" : `Pay @${creator.handle}`}
        </button>
        <p className="fine">
          Next step: copy the collect message into their TikTok DMs. TikTok
          does not let this site message them for you.
        </p>
      </section>
    </main>
  );
}

function Done({
  receipt,
  onAgain,
  onPreview,
}: {
  receipt: Receipt;
  onAgain: () => void;
  onPreview: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const message = dmMessage({
    from: receipt.from,
    amount: receipt.amount,
    note: receipt.note,
    handle: receipt.creator.handle,
    ref: receipt.ref,
  });
  const link = claimUrl(receipt.creator.handle, receipt.ref, receipt.amount);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function sendInTikTok() {
    await copyMessage();
    window.open(tiktokUrl(receipt.creator.handle), "_blank", "noopener,noreferrer");
  }

  return (
    <main className="page done-page">
      <p className="kicker">Paid · now DM them</p>
      <h1 className="headline">
        Send this in
        <br />
        <em>@{receipt.creator.handle}’s DMs</em>
      </h1>
      <p className="lede">
        {formatMoney(receipt.amount)} is held as {receipt.ref}. They collect
        when they tap the link you paste in TikTok.
      </p>

      <section className="dm-card">
        <p className="section-label">Message to paste</p>
        <p className="dm-bubble">{message}</p>
        <p className="fine">Link: {link}</p>
        <div className="actions">
          <button className="primary" onClick={sendInTikTok}>
            Copy & open TikTok
          </button>
          <button className="secondary" onClick={copyMessage}>
            {copied ? "Copied" : "Copy message"}
          </button>
        </div>
      </section>

      {receipt.note && <blockquote className="note">“{receipt.note}”</blockquote>}

      <button className="back" onClick={onPreview}>
        Preview what they see when they tap the link
      </button>
      <button className="secondary" onClick={onAgain}>
        Pay another handle
      </button>
    </main>
  );
}

function Claim({
  link,
  stored,
  onHome,
}: {
  link: ClaimLink;
  stored: Receipt | null;
  onHome: () => void;
}) {
  const creator = creatorFor(link.handle);
  const amount = stored?.amount ?? link.amount;
  const from = stored?.from ?? "A fan";
  const note = stored?.note ?? "";
  const [status, setStatus] = useState<"ready" | "paying" | "paid">("ready");

  function collect() {
    setStatus("paying");
    window.setTimeout(() => setStatus("paid"), 900);
  }

  return (
    <main className="page claim-page">
      <p className="kicker">From a TikTok DM</p>
      {status === "paid" ? (
        <>
          <h1 className="headline">
            {formatMoney(amount)}
            <br />
            <em>is yours.</em>
          </h1>
          <p className="lede">
            Demo payout for {link.ref}. In production this would send to the
            bank account tied to @{link.handle}.
          </p>
        </>
      ) : (
        <>
          <h1 className="headline">
            Collect {formatMoney(amount)}
            <br />
            <em>@{link.handle}</em>
          </h1>
          <p className="lede">
            {from} sent this. Confirm you own the TikTok, then it pays out.
          </p>
        </>
      )}

      <section className="profile">
        <Avatar creator={creator} large />
        <div>
          <p className="handle-line">@{creator.handle}</p>
          <h2 className="profile-name">{creator.name}</h2>
          {note && <p className="lede tight">“{note}”</p>}
        </div>
      </section>

      {status !== "paid" && (
        <button className="primary" disabled={status === "paying"} onClick={collect}>
          {status === "paying" ? "Paying out…" : "Collect to bank"}
        </button>
      )}
      <p className="fine">
        Live version would ask you to post a code on TikTok or log in, so only
        that handle can collect.
      </p>
      <button className="back" onClick={onHome}>
        Back to paymyhandle.com
      </button>
    </main>
  );
}

function Avatar({ creator, large }: { creator: Creator; large?: boolean }) {
  const letter = creator.handle.slice(0, 1).toUpperCase();
  return (
    <span
      className={`avatar ${large ? "avatar-lg" : ""}`}
      style={{ background: creator.accent }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
