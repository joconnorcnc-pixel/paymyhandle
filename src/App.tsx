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
  tiktokUrl,
  type ClaimLink,
  type Creator,
} from "./data";

type View = "home" | "pay" | "done" | "claim" | "terms" | "privacy";

type Receipt = {
  creator: Creator;
  amount: number;
  note: string;
  from: string;
  ref: string;
  sessionId: string;
  collected?: boolean;
};

type ClaimStatus = {
  handle: string;
  amount: number;
  note: string;
  from: string;
  ref: string;
  sessionId: string;
  livemode: boolean;
  collected: boolean;
  refunded: boolean;
  expired: boolean;
  connectReady: boolean;
  verifyCode: string;
  holdDays: number;
  transferId?: string | null;
  error?: string;
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
    .filter((item): item is Receipt => item !== null && Boolean(item.sessionId));
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
  const [payError, setPayError] = useState("");
  const [paying, setPaying] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [claim, setClaim] = useState<ClaimLink | null>(null);
  const [sent, setSent] = useState<Receipt[]>(() => loadReceipts());
  const [livemode, setLivemode] = useState(false);

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
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const cancel = params.get("cancel");
    const cancelHandle = params.get("handle");

    if (cancel === "1") {
      history.replaceState(null, "", window.location.pathname);
      if (cancelHandle) {
        goPay(cancelHandle);
        setPayError("Checkout cancelled. Try again when ready.");
      }
      return;
    }

    if (!sessionId) return;

    let cancelled = false;
    setRecovering(true);

    (async () => {
      try {
        const res = await fetch(`/api/session?session_id=${encodeURIComponent(sessionId)}`);
        const data = (await res.json()) as {
          error?: string;
          handle?: string;
          amount?: number;
          note?: string;
          from?: string;
          ref?: string;
          sessionId?: string;
          livemode?: boolean;
        };
        if (!res.ok) throw new Error(data.error || "Could not verify payment.");
        if (cancelled) return;

        const next: Receipt = {
          creator: creatorFor(data.handle!),
          amount: data.amount!,
          note: data.note ?? "",
          from: data.from || "Someone",
          ref: data.ref!,
          sessionId: data.sessionId || sessionId,
        };
        saveReceipt(next);
        setReceipt(next);
        setSent(loadReceipts());
        setLivemode(Boolean(data.livemode));
        setView("done");
        history.replaceState(null, "", window.location.pathname);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Payment verification failed.");
        setView("home");
        history.replaceState(null, "", window.location.pathname);
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
    setPayError("");
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

  async function onPay() {
    if (!creator || !validAmount || paying) return;
    setPaying(true);
    setPayError("");
    try {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: creator.handle,
          amount: payAmount,
          note: note.trim(),
          from: from.trim() || "Someone",
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not start Stripe Checkout.");
      }
      window.location.href = data.url;
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Checkout failed.");
      setPaying(false);
    }
  }

  function reset() {
    if (window.location.hash || window.location.search) {
      history.replaceState(null, "", window.location.pathname);
    }
    setView("home");
    setDraft("");
    setHandle("");
    setReceipt(null);
    setClaim(null);
    setError("");
  }

  function openClaim(next: Receipt) {
    if (!next.sessionId) {
      setError("This payment is missing a Stripe session. Pay again to get a collect link.");
      setView("home");
      return;
    }
    window.location.hash = `claim/${next.creator.handle}/${next.ref}/${Math.round(next.amount * 100)}/${next.sessionId}`;
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
          {view === "claim"
            ? "Collect"
            : view === "terms" || view === "privacy"
              ? "Legal"
              : "Pay a TikTok @"}
        </span>
      </header>

      {recovering ? (
        <main className="page">
          <p className="kicker">Stripe</p>
          <h1 className="headline">
            Confirming
            <br />
            <em>payment…</em>
          </h1>
          <p className="lede">Checking your card payment with Stripe.</p>
        </main>
      ) : (
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
                setLivemode(false);
                setView("done");
              }}
              onOpenClaim={openClaim}
              onTerms={() => setView("terms")}
              onPrivacy={() => setView("privacy")}
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
              payError={payError}
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
              livemode={livemode}
              onAgain={reset}
              onPreview={() => openClaim(receipt)}
            />
          )}

          {view === "claim" && claim && (
            <Claim link={claim} onHome={reset} onCollected={onCollected} />
          )}

          {view === "terms" && <Legal kind="terms" onBack={() => setView("home")} />}
          {view === "privacy" && <Legal kind="privacy" onBack={() => setView("home")} />}
        </div>
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
  onTerms,
  onPrivacy,
}: {
  draft: string;
  error: string;
  sent: Receipt[];
  onDraft: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onPick: (handle: string) => void;
  onOpenDm: (receipt: Receipt) => void;
  onOpenClaim: (receipt: Receipt) => void;
  onTerms: () => void;
  onPrivacy: () => void;
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
              <span>Card via Stripe. €1–€500.</span>
            </div>
          </li>
          <li>
            <span className="step-num">3</span>
            <div>
              <strong>They collect</strong>
              <span>DM link → verify → bank via Stripe.</span>
            </div>
          </li>
        </ol>
      </section>

      <footer className="foot">
        <p>
          You paste the DM; TikTok won’t send it for us. Unclaimed payments
          refund after 30 days.
        </p>
        <p className="legal-links">
          <button className="text-link" type="button" onClick={onTerms}>
            Terms
          </button>
          <button className="text-link" type="button" onClick={onPrivacy}>
            Privacy
          </button>
        </p>
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
  payError,
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
  payError: string;
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
        {payError && <p className="error">{payError}</p>}

        <button
          className="primary"
          disabled={!validAmount || paying}
          onClick={onPay}
          type="button"
        >
          {paying ? "Opening Stripe…" : `Pay @${creator.handle} with card`}
        </button>
        <p className="fine">
          Stripe Checkout. Next you’ll DM them the collect link.
        </p>
      </section>
    </main>
  );
}

function Done({
  receipt,
  livemode,
  onAgain,
  onPreview,
}: {
  receipt: Receipt;
  livemode: boolean;
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
    sessionId: receipt.sessionId,
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
      <p className="kicker">{livemode ? "Paid · next: DM" : "Test paid · next: DM"}</p>
      <h1 className="headline">
        Send this in
        <br />
        <em>@{receipt.creator.handle}’s DMs</em>
      </h1>
      <p className="lede">
        {formatMoney(receipt.amount)} held as {receipt.ref}
        {livemode ? "" : " (Stripe test mode)"}. They collect when they tap your
        link.
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
  onHome,
  onCollected,
}: {
  link: ClaimLink;
  onHome: () => void;
  onCollected: (ref: string) => void;
}) {
  const creator = creatorFor(link.handle);
  const [status, setStatus] = useState<ClaimStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [phase, setPhase] = useState<"load" | "ready" | "paid" | "refunded" | "expired">(
    "load",
  );

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/claim-status?session_id=${encodeURIComponent(link.sessionId)}`,
      );
      const data = (await res.json()) as ClaimStatus;
      if (!res.ok) throw new Error(data.error || "Could not load this payment.");
      setStatus(data);
      if (data.refunded) setPhase("refunded");
      else if (data.collected) setPhase("paid");
      else if (data.expired) {
        setPhase("expired");
        try {
          await fetch("/api/expire", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: link.sessionId }),
          });
          setPhase("refunded");
        } catch {
          /* keep expired state */
        }
      } else setPhase("ready");
      if (data.verifyCode) setCodeInput(data.verifyCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [link.sessionId]);

  async function startConnect() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/connect-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: link.handle,
          session_id: link.sessionId,
          country: "IE",
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string; ready?: boolean };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not start Stripe Connect.");
      }
      if (data.ready) {
        await refresh();
      } else {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    if (!status) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: link.handle,
          session_id: link.sessionId,
          confirmed,
          verify_code: codeInput.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string; transferId?: string };
      if (!res.ok) throw new Error(data.error || "Collect failed.");
      onCollected(link.ref);
      setPhase("paid");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Collect failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !status) {
    return (
      <main className="page claim-page">
        <p className="kicker">From a TikTok DM</p>
        <h1 className="headline">
          Loading
          <br />
          <em>payment…</em>
        </h1>
        {error && <p className="error">{error}</p>}
        <button className="back" onClick={onHome} type="button">
          ← paymyhandle.com
        </button>
      </main>
    );
  }

  const amount = status.amount;

  return (
    <main className="page claim-page">
      <p className="kicker">From a TikTok DM</p>

      {phase === "paid" && (
        <>
          <h1 className="headline">
            {formatMoney(amount)}
            <br />
            <em>is on the way.</em>
          </h1>
          <p className="lede">
            Transferred to your Stripe account for @{link.handle}. Payouts follow
            your Stripe schedule.
          </p>
          <p className="ok-line">Collected ✓</p>
        </>
      )}

      {phase === "refunded" && (
        <>
          <h1 className="headline">
            Refunded
            <br />
            <em>to the fan.</em>
          </h1>
          <p className="lede">This payment wasn’t claimed in time.</p>
        </>
      )}

      {phase === "expired" && (
        <>
          <h1 className="headline">
            Expired
            <br />
            <em>after 30 days.</em>
          </h1>
          <p className="lede">Unclaimed funds are refunded to the original card.</p>
        </>
      )}

      {phase === "ready" && (
        <>
          <h1 className="headline">
            Collect {formatMoney(amount)}
            <br />
            <em>@{link.handle}</em>
          </h1>
          <p className="lede">
            {status.from} sent this
            {status.note ? `: “${status.note}”` : "."} Prove the @, connect a
            bank, then collect.
          </p>

          <section className="profile">
            <Avatar creator={creator} large />
            <div>
              <p className="handle-line">@{creator.handle}</p>
              <h2 className="profile-name">{creator.name}</h2>
            </div>
          </section>

          <section className="pay-card">
            <h2 className="section-label">1 · Prove it’s you</h2>
            <p className="fine">
              Put <strong>{status.verifyCode}</strong> in your TikTok bio, then
              enter it here.
            </p>
            <label className="field">
              <span>Bio code</span>
              <input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                placeholder={status.verifyCode}
                autoCapitalize="characters"
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>I own @{link.handle} on TikTok</span>
            </label>

            <h2 className="section-label">2 · Bank</h2>
            {status.connectReady ? (
              <p className="ok-line">Stripe bank connected ✓</p>
            ) : (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={startConnect}
              >
                {busy ? "Opening Stripe…" : "Connect bank with Stripe"}
              </button>
            )}

            <h2 className="section-label">3 · Collect</h2>
            <button
              className="primary"
              type="button"
              disabled={busy || !confirmed || !status.connectReady}
              onClick={collect}
            >
              {busy ? "Transferring…" : `Collect ${formatMoney(amount)}`}
            </button>
            {error && <p className="error">{error}</p>}
            <p className="fine">
              Held up to {status.holdDays} days. Card fee stays with paymyhandle;
              they receive the tip amount.
            </p>
          </section>
        </>
      )}

      <button className="back" onClick={onHome} type="button">
        ← paymyhandle.com
      </button>
    </main>
  );
}

function Legal({ kind, onBack }: { kind: "terms" | "privacy"; onBack: () => void }) {
  return (
    <main className="page legal-page">
      <button className="back" onClick={onBack} type="button">
        ← Home
      </button>
      {kind === "terms" ? (
        <>
          <h1 className="headline">Terms</h1>
          <div className="legal-body">
            <p>
              paymyhandle.com lets fans send money to a TikTok handle. Payments
              are processed by Stripe. Funds are held for up to 30 days until the
              handle owner collects via Stripe Connect.
            </p>
            <p>
              You must only pay handles you intend to tip. Creators must only
              collect for handles they own. Unclaimed payments are refunded to
              the original payment method after 30 days.
            </p>
            <p>
              paymyhandle is not affiliated with TikTok. We cannot send TikTok
              DMs on your behalf. Demo or test-mode charges may appear in Stripe
              test mode.
            </p>
            <p>Contact: use your Stripe dashboard for payment disputes.</p>
          </div>
        </>
      ) : (
        <>
          <h1 className="headline">Privacy</h1>
          <div className="legal-body">
            <p>
              We process payment details through Stripe. We store payment
              metadata (handle, amount, note, name you enter) with Stripe to run
              checkout, claims, and refunds.
            </p>
            <p>
              Browser local storage may keep a copy of recent receipts on your
              device so you can resend a DM. Clear site data to remove it.
            </p>
            <p>
              We do not sell your data. Stripe’s privacy policy also applies to
              card processing.
            </p>
          </div>
        </>
      )}
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
