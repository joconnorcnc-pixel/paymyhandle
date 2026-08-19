import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  amounts,
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
  collected?: boolean;
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

function markCollected(ref: string) {
  const receipt = loadReceipt(ref);
  if (!receipt) return;
  saveReceipt({ ...receipt, collected: true });
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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

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
    }, 900);
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

  function onCollected(ref: string) {
    markCollected(ref);
    setSent(loadReceipts());
  }

  return (
    <div className="shell">
      <div className="glow" aria-hidden />
      <header className="nav">
        <button className="mark" onClick={reset} type="button">
          paymyhandle
        </button>
        <span className="nav-meta">
          {view === "claim" ? "Collect" : "Pay a TikTok @"}
        </span>
      </header>

      <div key={view} className="view-enter">
        {view === "home" && (
          <Home
            draft={draft}
            error={error}
            sent={sent.filter((item) => !item.collected)}
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
            onCollected={onCollected}
          />
        )}
      </div>
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <main className="page">
      <section className="hero">
        <p className="brand-hero">paymyhandle.com</p>
        <h1 className="headline">
          Pay any
          <br />
          <em>TikTok handle.</em>
        </h1>
        <p className="lede">
          Type an @, pay, then DM them the collect link. They tap it — money’s
          theirs.
        </p>

        <form className="search" onSubmit={onSearch}>
          <label className="search-field">
            <span className="at">@</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              placeholder="their.tiktok"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="TikTok handle"
            />
          </label>
          <button className="primary" type="submit" disabled={!draft.trim()}>
            Continue
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      {sent.length > 0 && (
        <section className="rise">
          <h2 className="section-label">Waiting on a DM</h2>
          <ul className="creator-grid">
            {sent.map((item) => (
              <li key={item.ref}>
                <div className="sent-card">
                  <button
                    className="creator-card"
                    onClick={() => onOpenDm(item)}
                    type="button"
                  >
                    <Avatar creator={item.creator} />
                    <span className="creator-copy">
                      <strong>
                        {formatMoney(item.amount)} → @{item.creator.handle}
                      </strong>
                      <span className="muted">{item.ref} · copy again</span>
                    </span>
                  </button>
                  <button
                    className="text-link"
                    onClick={() => onOpenClaim(item)}
                    type="button"
                  >
                    Collect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rise delay-1">
        <h2 className="section-label">Try a handle</h2>
        <ul className="creator-grid">
          {creators.map((item) => (
            <li key={item.handle}>
              <button
                className="creator-card"
                onClick={() => onPick(item.handle)}
                type="button"
              >
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

      <section className="steps rise delay-2">
        <h2 className="section-label">How it works</h2>
        <ol className="step-list">
          <li>
            <span className="step-num">1</span>
            <div>
              <strong>Find them</strong>
              <span>Same @ they use on TikTok.</span>
            </div>
          </li>
          <li>
            <span className="step-num">2</span>
            <div>
              <strong>Pay</strong>
              <span>€1–€500. Note optional.</span>
            </div>
          </li>
          <li>
            <span className="step-num">3</span>
            <div>
              <strong>DM the link</strong>
              <span>They tap it to collect.</span>
            </div>
          </li>
        </ol>
      </section>

      <footer className="foot">
        Demo checkout — no real charges. You paste the DM; TikTok won’t let us
        send it.
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
      <button className="back" onClick={onBack} type="button">
        ← All handles
      </button>

      <section className="profile">
        <Avatar creator={creator} large />
        <div>
          <p className="handle-line">
            @{creator.handle}
            {creator.verified && <span className="badge">On TikTok</span>}
            {!known && <span className="badge dim">New</span>}
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
          <span>Custom €</span>
          <input
            inputMode="decimal"
            placeholder="25"
            value={custom}
            onChange={(event) => onCustom(event.target.value.replace(/[^\d.]/g, ""))}
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
            placeholder="Your name"
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
            <span>Fee</span>
            <span>{validAmount ? formatMoney(fee) : "—"}</span>
          </p>
          <p className="due">
            <span>You pay</span>
            <strong>{validAmount ? formatMoney(payAmount + fee) : "—"}</strong>
          </p>
        </div>

        {custom.trim() !== "" && !validAmount && (
          <p className="error">Enter an amount between €1 and €500.</p>
        )}

        <button
          className="primary"
          disabled={!validAmount || paying}
          onClick={onPay}
          type="button"
        >
          {paying ? "Holding…" : `Pay @${creator.handle}`}
        </button>
        <p className="fine">
          After this you’ll copy a message into their TikTok DMs.
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

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
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
      <p className="kicker">Held · next: DM</p>
      <h1 className="headline">
        Send this in
        <br />
        <em>@{receipt.creator.handle}’s DMs</em>
      </h1>
      <p className="lede">
        {formatMoney(receipt.amount)} ready as {receipt.ref}. They collect when
        they tap your link.
      </p>

      <section className="dm-card">
        <p className="section-label">Message to paste</p>
        <p className="dm-bubble">{message}</p>
        <div className="actions">
          <button className="primary" onClick={sendInTikTok} type="button">
            Copy & open TikTok
          </button>
          <button className="secondary" onClick={copyMessage} type="button">
            {copied ? "Copied ✓" : "Copy message"}
          </button>
        </div>
      </section>

      {receipt.note && <blockquote className="note">“{receipt.note}”</blockquote>}

      <div className="done-links">
        <button className="back" onClick={onPreview} type="button">
          Preview their collect page →
        </button>
        <button className="secondary" onClick={onAgain} type="button">
          Pay another handle
        </button>
      </div>
    </main>
  );
}

function Claim({
  link,
  stored,
  onHome,
  onCollected,
}: {
  link: ClaimLink;
  stored: Receipt | null;
  onHome: () => void;
  onCollected: (ref: string) => void;
}) {
  const creator = creatorFor(link.handle);
  const amount = stored?.amount ?? link.amount;
  const from = stored?.from ?? "A fan";
  const note = stored?.note ?? "";
  const [status, setStatus] = useState<"ready" | "paying" | "paid">(
    stored?.collected ? "paid" : "ready",
  );

  function collect() {
    setStatus("paying");
    window.setTimeout(() => {
      onCollected(link.ref);
      setStatus("paid");
    }, 800);
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
            Demo payout for {link.ref}. Live, this hits the bank tied to @
            {link.handle}.
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
        <button
          className="primary"
          disabled={status === "paying"}
          onClick={collect}
          type="button"
        >
          {status === "paying" ? "Paying out…" : "Collect to bank"}
        </button>
      )}
      {status === "paid" && (
        <p className="ok-line">Collected · demo only</p>
      )}
      <p className="fine">
        Live version verifies the TikTok first — a bio code or login — so only
        that @ can collect.
      </p>
      <button className="back" onClick={onHome} type="button">
        ← paymyhandle.com
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
