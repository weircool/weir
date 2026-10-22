import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  decodeEventLog,
  isAddress,
  keccak256,
  toBytes,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import {
  useBalance,
  useRead,
  useReady,
  useRuntime,
  useToken,
  useTransaction,
} from "./data";
import { useWalletClient } from "wagmi";
import {
  address,
  amount,
  byteLength,
  describeDuration,
  errorText,
  jobId,
  tryAmount,
  UINT128_MAX,
  units,
  clearHoldIntent,
  markHoldIntent,
} from "./domain";
import { ApprovalAction } from "./actions";
import { Eligibility } from "./Home";
import { AddressView, Field, Notice, QueryState, Title, TxButton, TxFeedback } from "./ui";
import { ConnectPrompt } from "./Wallet";

/** Wrap ETH into WETH so it can be streamed; the recipient can unwrap it any time. */
function WrapEth({ needed, decimals }: { needed: bigint; decimals: number }) {
  const r = useRuntime();
  const gate = useReady();
  const { data: wallet } = useWalletClient({ chainId: r.chain.id });
  const weth = WETH[r.chain.id];
  const balance = useBalance(weth, gate.address);
  const [state, setState] = useState<"idle" | "signing" | "pending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  if (!weth || balance.data === undefined || balance.data >= needed) return null;
  const missing = needed - balance.data;
  return (
    <div className="notice">
      <p>
        You hold {units(balance.data, decimals)} WETH. Wrap {units(missing, decimals)} ETH first
        (one wallet step), then approve and create.
      </p>
      <button
        type="button"
        disabled={!gate.ready || !wallet || state === "signing" || state === "pending"}
        onClick={async () => {
          try {
            setState("signing");
            setMessage("");
            const hash = await wallet!.writeContract({
              address: weth,
              abi: WETH_ABI,
              functionName: "deposit",
              value: missing,
              chain: r.chain,
              account: gate.address!,
            });
            setState("pending");
            const receipt = await r.client.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") throw new Error("The wrap reverted.");
            setState("done");
            await balance.refetch();
          } catch (e) {
            setState("error");
            setMessage(errorText(e));
          }
        }}
      >
        {state === "signing" ? "Confirm in your wallet…" : state === "pending" ? "Wrapping…" : `Wrap ${units(missing, decimals)} ETH`}
      </button>
      {message && <p className="field-error">{message}</p>}
    </div>
  );
}

/**
 * Pauses a freshly created stream so nothing streams until the recipient accepts the terms and the
 * client starts it. The contract has no "create paused", so this is a second transaction right after
 * create; the few seconds in between stream at the full rate (fractions of a cent at normal rates).
 *
 * Public RPC nodes can lag the block that created the stream, so the pause is simulated only once a
 * node reports the stream as Active and running, and a failed attempt is retried a few times before
 * the manual button is the only way forward.
 */
function HoldStep({ id }: { id: bigint }) {
  const r = useRuntime();
  const gate = useReady();
  const tx = useTransaction();
  const [done, setDone] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(true);
  // Resolve once the RPC in use sees the stream as Active with a positive rate.
  const seen = async () => {
    for (let i = 0; i < 20; i++) {
      try {
        const s = (await r.client.readContract({
          address: r.weir.address,
          abi: r.weir.abi,
          functionName: "streams",
          args: [id],
        })) as { state: number; rate: bigint };
        if (s.state === 1 && s.rate > 0n) return true;
        if (s.state === 1 && s.rate === 0n) return false; // already paused
      } catch {
        /* node not caught up or briefly unavailable */
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return true;
  };
  const run = async () => {
    setWaiting(true);
    const running = await seen();
    setWaiting(false);
    if (!running) {
      setDone(true);
      clearHoldIntent(id);
      return;
    }
    const receipt = await tx.run("pause", [id]);
    if (receipt) {
      setDone(true);
      clearHoldIntent(id);
    }
  };
  useEffect(() => {
    if (!gate.ready || done || tx.pending) return;
    if (attempt >= 3) return;
    setAttempt((n) => n + 1);
    void run();
    // Runs when the wallet is ready, and again after a failed attempt (up to three tries).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.ready, tx.state.phase === "error" ? attempt : -1]);
  const href = `#/stream/${id.toString()}`;
  return (
    <div className="hold-step" role="status">
      <ol className="steps" aria-label="Create stream steps">
        <li className="done">✓ Approve</li>
        <li className="done">✓ Create stream</li>
        <li className={done ? "done" : "current"}>{done ? "✓" : "3"} Hold the stream</li>
      </ol>
      <h3>{done ? "Stream created and on hold" : "Step 3 of 3: it is not on hold yet"}</h3>
      {done ? (
        <>
          <p>
            Nothing streams until the recipient accepts the terms and you start it. You can take
            everything back before then.
          </p>
          <a className="button primary" href={href}>
            Open stream #{id.toString()}
          </a>
        </>
      ) : (
        <>
          <Notice error>
            <strong>The stream is running and paying out right now.</strong> One more signature
            pauses it. Stay on this page and confirm the pause in your wallet when it appears; it
            can take up to a minute to show. Every second until then is paid to the recipient.
          </Notice>
          {!gate.ready && <Notice>{gate.reason}</Notice>}
          {waiting && gate.ready && (
            <p className="muted">Waiting for the network to confirm the new stream…</p>
          )}
          <div className="action-row">
            <TxButton
              label="Pause the stream"
              pending={tx.pending || waiting}
              phase={waiting ? "checking" : tx.state.phase}
              disabled={!gate.ready}
              onClick={run}
              primary
            />
            <a className="button" href={href} onClick={() => clearHoldIntent(id)}>
              Skip and leave it running
            </a>
          </div>
          <TxFeedback state={tx.state} />
        </>
      )}
    </div>
  );
}

/** Named tokens offered on Robinhood Chain (4663). Symbol and decimals are still read from the contract. */
const NAMED_TOKENS: Record<number, { label: string; address: Address; note: string }[]> = {
  4663: [
    {
      label: "USDG",
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      note: "Dollar token",
    },
    {
      label: "WEIR",
      address: "0x58b82fa656ecf47a0dca5be6bad06b92e22f7dbe",
      note: "Weir token",
    },
    {
      label: "IMD",
      address: "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127",
      note: "Identity.md token",
    },
    {
      label: "ETH",
      address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      note: "Wrapped, as WETH",
    },
  ],
};
const WETH: Record<number, Address> = { 4663: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" };
const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;
const TERMS_LIMIT = 512;
const PERIODS = { day: 86400n, week: 604800n } as const;
type Period = keyof typeof PERIODS;
/** "One payment" streams a fixed total over a span; "ongoing" sets a rate and a first deposit. */
type Mode = "once" | "ongoing";

type Draft = {
  recipient: Address;
  token: Address;
  rate: bigint;
  deposit: bigint;
  hash: Hex;
  uri: string;
  job: Hex;
  mode: Mode;
  /** Ongoing: the amount per period. One payment: the total. */
  perPeriod: bigint;
  period: Period;
  /** One payment: how many periods the total is spread over. */
  spanCount: number;
  /** Pause right after create so nothing streams until the recipient accepts and the client starts it. */
  hold: boolean;
};

/** Whole seconds the deposit lasts at this rate. */
const lasts = (deposit: bigint, rate: bigint) => (rate > 0n ? deposit / rate : 0n);

export function Create() {
  const r = useRuntime();
  const { address: account } = useAccount();
  const eligible = useRead<boolean>("canUse", [account], !!account);
  const named = NAMED_TOKENS[r.chain.id] ?? [];
  const [recipient, setRecipient] = useState("");
  const [choice, setChoice] = useState<string>(named[0]?.address ?? "");
  const [custom, setCustom] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("once");
  const [perPeriod, setPerPeriod] = useState("");
  const [period, setPeriod] = useState<Period>("day");
  const [spanCount, setSpanCount] = useState("1");
  const [deposit, setDeposit] = useState("");
  const [hold, setHold] = useState(true);
  const [terms, setTerms] = useState("");
  const [link, setLink] = useState("");
  const [job, setJob] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<bigint>();
  const [invalid, setInvalid] = useState<{ name: string; message: string }>();
  const fieldError = (name: string) =>
    invalid?.name === name ? invalid.message : undefined;

  const tokenInput = customOpen ? custom : choice;
  const tokenAddress = isAddress(tokenInput.trim())
    ? (tokenInput.trim() as Address)
    : undefined;
  const token = useToken(tokenAddress);
  const symbol = token.data?.symbol ?? "";

  // The terms as stored on-chain: the text itself, plus the link to a longer document when given.
  const onChain = [terms.trim(), link.trim()].filter(Boolean).join("\n");
  const termsBytes = byteLength(onChain);
  const perAmount = token.data
    ? tryAmount(perPeriod, token.data.decimals, UINT128_MAX)
    : undefined;
  const span = /^\d+$/.test(spanCount.trim()) ? Number(spanCount.trim()) : 0;
  const spanSeconds = PERIODS[period] * BigInt(span);
  // One payment: rate = total / span. Ongoing: rate = amount / period.
  const rate =
    perAmount === undefined
      ? undefined
      : mode === "once"
        ? span > 0
          ? perAmount / spanSeconds
          : undefined
        : perAmount / PERIODS[period];
  const depositAmount = token.data
    ? mode === "once"
      ? perAmount
      : tryAmount(deposit, token.data.decimals, UINT128_MAX)
    : undefined;
  const runtime =
    rate && depositAmount !== undefined && rate > 0n
      ? lasts(depositAmount, rate)
      : undefined;
  // Ongoing only: a first deposit that does not even cover one period is nearly always a slip.
  const shortDeposit =
    mode === "ongoing" &&
    runtime !== undefined &&
    depositAmount !== undefined &&
    depositAmount > 0n &&
    runtime < PERIODS[period];

  function review() {
    setInvalid(undefined);
    const fail = (name: string, message: string): never => {
      setInvalid({ name, message });
      document
        .querySelector<HTMLElement>(`[name="${name}"]`)
        ?.focus();
      throw new Error(message);
    };
    const checked = <T,>(name: string, read: () => T): T => {
      try {
        return read();
      } catch (e) {
        return fail(name, errorText(e));
      }
    };
    try {
      if (!account) throw new Error("Connect your wallet first.");
      if (!eligible.data)
        throw new Error("You need to hold 10,000 WEIR to start a stream.");
      const rec = checked("recipient", () => address(recipient));
      if (
        [account.toLowerCase(), r.weir.address.toLowerCase()].includes(
          rec.toLowerCase(),
        )
      )
        fail("recipient", "Pay someone other than yourself.");
      const tok = checked("token", () => address(tokenInput));
      if (!token.data) throw new Error("Give the token a moment to load.");
      const per = checked("perPeriod", () =>
        amount(perPeriod, token.data!.decimals, UINT128_MAX),
      );
      if (mode === "once" && span === 0)
        fail("spanCount", "Say how many days or weeks the payment is spread over.");
      const rateValue = mode === "once" ? per / spanSeconds : per / PERIODS[period];
      if (rateValue === 0n)
        fail(
          "perPeriod",
          `That is less than the smallest unit of ${symbol} per second. Raise the amount${mode === "once" ? " or shorten the time" : ""}.`,
        );
      const depositValue =
        mode === "once"
          ? per
          : checked("deposit", () =>
              amount(deposit, token.data!.decimals, UINT128_MAX),
            );
      if (!terms.trim())
        fail("terms", "Say what is being delivered and by when.");
      if (termsBytes > TERMS_LIMIT)
        fail(
          "terms",
          `Keep the terms under ${TERMS_LIMIT} characters, or shorten them and add a link to the full document.`,
        );
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(onChain))
        fail("terms", "Remove unusual control characters from the terms.");
      if (link.trim() && !/^(https?:\/\/|ipfs:\/\/)\S+$/i.test(link.trim()))
        fail("link", "Use a full https:// or ipfs:// link.");
      setDraft({
        recipient: rec,
        token: tok,
        rate: rateValue,
        deposit: depositValue,
        hash: keccak256(toBytes(onChain)),
        uri: onChain,
        job: checked("imdJobId", () => jobId(job)),
        mode,
        perPeriod: per,
        period,
        spanCount: span,
        hold,
      });
      setError("");
      window.scrollTo(0, 0);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <Title>Start a stream</Title>
      <p className="page-description">
        Say who, how much, and what for. Money moves per second once it is
        funded, and you can pause or stop any time.
      </p>
      <Notice>
        Before you fund a stream: if the other person opens a dispute, your
        stream pauses until it is settled. They then wait seven days before
        they can dispute it again, and you can stop the stream and take back
        what is unearned in between. Stream only to people you trust and keep
        deposits small. Reviewers read your agreement word for word, so write
        only the work and the deadline.
      </Notice>
      {!account ? <ConnectPrompt /> : <Eligibility compact />}
      {draft && token.data ? (
        <section className="form-surface review-surface">
          <h2>Check it over</h2>
          <dl className="detail-list">
            <div>
              <dt>Paying</dt>
              <dd>
                <AddressView value={draft.recipient} full />
              </dd>
            </div>
            {draft.mode === "once" ? (
              <div>
                <dt>Paying</dt>
                <dd>
                  {units(draft.deposit, token.data.decimals)} {token.data.symbol} in
                  total, streamed over {draft.spanCount} {draft.period}
                  {draft.spanCount === 1 ? "" : "s"}
                  <small className="muted">
                    {units(draft.rate, token.data.decimals)} {token.data.symbol}{" "}
                    every second, rounded down to the smallest unit. The whole amount
                    leaves your wallet now and is fully paid out in{" "}
                    {describeDuration(lasts(draft.deposit, draft.rate))}.
                  </small>
                </dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>Rate</dt>
                  <dd>
                    {units(draft.perPeriod, token.data.decimals)} {token.data.symbol}{" "}
                    per {draft.period}
                    <small className="muted">
                      {units(draft.rate, token.data.decimals)} {token.data.symbol}{" "}
                      every second, rounded down to the smallest unit
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Deposit now</dt>
                  <dd>
                    {units(draft.deposit, token.data.decimals)} {token.data.symbol}
                    <small
                      className={
                        lasts(draft.deposit, draft.rate) < PERIODS[draft.period]
                          ? "field-warning"
                          : "muted"
                      }
                    >
                      Lasts {describeDuration(lasts(draft.deposit, draft.rate))} at this
                      rate. Top up on the stream page to keep it running.
                    </small>
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt>Starts</dt>
              <dd>
                {draft.hold ? "When they accept and you start it" : "Right away"}
                <small className="muted">
                  {draft.hold
                    ? "The stream is created on hold. Nothing is paid out until the recipient accepts the terms and you start it; you can take everything back before then."
                    : "Money streams from the moment the stream is created, whether or not the recipient has accepted the terms. What has streamed is theirs to withdraw, even if they never do."}
                </small>
              </dd>
            </div>
            <div>
              <dt>Terms</dt>
              <dd className="terms-preview">{draft.uri}</dd>
            </div>
            {draft.job !== zeroHash && (
              <div>
                <dt>IMD job</dt>
                <dd className="hash">{draft.job}</dd>
              </div>
            )}
          </dl>
          <p className="muted">
            The terms are stored with the stream, word for word. Reviewers read
            exactly this text if there is ever a disagreement.
          </p>
          {draft.hold ? (
            <Notice>
              <strong>Three wallet signatures, not two.</strong> 1 allow the deposit, 2 create
              the stream, 3 hold it. The stream starts paying out the moment step 2 confirms;
              step 3 pauses it. Stay on this page until the third signature is confirmed.
            </Notice>
          ) : (
            <Notice>
              <strong>Two wallet signatures.</strong> 1 allow the deposit, 2 create the stream.
              Money streams from the moment step 2 confirms.
            </Notice>
          )}
          {draft.token.toLowerCase() === WETH[r.chain.id]?.toLowerCase() && (
            <WrapEth needed={draft.deposit} decimals={token.data.decimals} />
          )}
          {created !== undefined ? (
            <HoldStep id={created} />
          ) : (
          <ApprovalAction
            token={token.data}
            amount={draft.deposit}
            name="createStream"
            args={[
              draft.recipient,
              draft.token,
              draft.rate,
              draft.deposit,
              draft.hash,
              draft.uri,
              draft.job,
            ]}
            label="Create stream"
            after={draft.hold ? ["Hold the stream"] : []}
            disabled={!eligible.data || eligible.isError}
            onBusy={setBusy}
            onDone={(receipt) => {
              for (const log of receipt.logs) {
                try {
                  const decoded = decodeEventLog({
                    abi: r.weir.abi,
                    data: log.data,
                    topics: log.topics,
                  }) as { eventName: string; args: unknown };
                  if (decoded.eventName === "StreamCreated") {
                    const id = (decoded.args as { id: bigint }).id;
                    if (draft.hold) {
                      markHoldIntent(id);
                      setCreated(id);
                      return;
                    }
                    location.hash = `/stream/${id}`;
                    return;
                  }
                } catch {
                  /* another contract's event */
                }
              }
              location.hash = "/streams";
            }}
          />
          )}
          <button
            className="text-button"
            disabled={busy || created !== undefined}
            onClick={() => setDraft(undefined)}
          >
            Go back and change something
          </button>
        </section>
      ) : (
        <form
          className="create-grid"
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
          noValidate
        >
          <div className="form-surface">
            <h2>Who and how much</h2>
            <Field
              error={fieldError("recipient")}
              label="Who are you paying?"
              hint="Their wallet address. They withdraw what has streamed, any time."
            >
              <input
                name="recipient"
                autoComplete="off"
                spellCheck={false}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
              />
            </Field>
            <Field error={fieldError("token")} label="Pay with">
              <div className="token-picker" role="radiogroup" aria-label="Token">
                {named.map((t) => (
                  <button
                    type="button"
                    key={t.address}
                    role="radio"
                    aria-checked={!customOpen && choice === t.address}
                    className={`token-option${!customOpen && choice === t.address ? " selected" : ""}`}
                    onClick={() => {
                      setChoice(t.address);
                      setCustomOpen(false);
                    }}
                  >
                    <strong>{t.label}</strong>
                    <span>{t.note}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={customOpen}
                  className={`token-option${customOpen ? " selected" : ""}`}
                  onClick={() => setCustomOpen(true)}
                >
                  <strong>Another token</strong>
                  <span>By address</span>
                </button>
              </div>
              {customOpen && (
                <input
                  name="token"
                  autoComplete="off"
                  spellCheck={false}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Token contract address 0x…"
                  aria-label="Token contract address"
                />
              )}
            </Field>
            {tokenAddress && <QueryState query={token} />}
            {tokenAddress?.toLowerCase() === WETH[r.chain.id]?.toLowerCase() && (
              <small className="muted">
                ETH is streamed as WETH: we wrap it for you before the stream
                starts, and the recipient can unwrap it back to ETH any time.
              </small>
            )}
            <div className="mode-toggle" role="radiogroup" aria-label="Kind of payment">
              {(
                [
                  ["once", "One payment", "A fixed amount, paid out over a set time."],
                  ["ongoing", "Ongoing", "A rate per day or week. Top up as you go."],
                ] as [Mode, string, string][]
              ).map(([m, title, note]) => (
                <button
                  type="button"
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? "selected" : ""}
                  onClick={() => setMode(m)}
                >
                  <strong>{title}</strong>
                  <small>{note}</small>
                </button>
              ))}
            </div>
            {mode === "once" ? (
              <>
                <Field
                  error={fieldError("perPeriod")}
                  label={`Total${symbol ? ` (${symbol})` : ""}`}
                  hint="Leaves your wallet when you create the stream. They earn it second by second; anything not yet earned comes back if you stop."
                >
                  <input
                    name="perPeriod"
                    inputMode="decimal"
                    value={perPeriod}
                    onChange={(e) => setPerPeriod(e.target.value)}
                    placeholder="25"
                  />
                </Field>
                <Field
                  error={fieldError("spanCount")}
                  label="Over"
                  hint={
                    rate !== undefined && rate > 0n && token.data && runtime !== undefined
                      ? `${units(rate, token.data.decimals)} ${symbol} every second. Fully paid in ${describeDuration(runtime)}.`
                      : "How long the payment is spread over."
                  }
                >
                  <div className="amount-row">
                    <input
                      name="spanCount"
                      inputMode="numeric"
                      value={spanCount}
                      onChange={(e) => setSpanCount(e.target.value)}
                      placeholder="1"
                    />
                    <div className="period-toggle" role="radiogroup" aria-label="Unit">
                      {(["day", "week"] as Period[]).map((p) => (
                        <button
                          type="button"
                          key={p}
                          role="radio"
                          aria-checked={period === p}
                          className={period === p ? "selected" : ""}
                          onClick={() => setPeriod(p)}
                        >
                          {p}
                          {span === 1 ? "" : "s"}
                        </button>
                      ))}
                    </div>
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field
                  error={fieldError("perPeriod")}
                  label={`Rate${symbol ? ` (${symbol})` : ""}`}
                  hint={
                    rate !== undefined && token.data
                      ? `${units(rate, token.data.decimals)} ${symbol} every second.`
                      : "What they earn each day or each week while the stream runs."
                  }
                >
                  <div className="amount-row">
                    <input
                      name="perPeriod"
                      inputMode="decimal"
                      value={perPeriod}
                      onChange={(e) => setPerPeriod(e.target.value)}
                      placeholder="500"
                    />
                    <div className="period-toggle" role="radiogroup" aria-label="Per">
                      {(["day", "week"] as Period[]).map((p) => (
                        <button
                          type="button"
                          key={p}
                          role="radio"
                          aria-checked={period === p}
                          className={period === p ? "selected" : ""}
                          onClick={() => setPeriod(p)}
                        >
                          per {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </Field>
                <Field
                  error={fieldError("deposit")}
                  label={`Deposit now${symbol ? ` (${symbol})` : ""}`}
                  hint={
                    shortDeposit && runtime !== undefined && perAmount ? (
                      <span className="field-warning">
                        Lasts only {describeDuration(runtime)} at this rate. For a full{" "}
                        {period}, deposit {units(perAmount, token.data!.decimals)} {symbol}.
                      </span>
                    ) : runtime !== undefined && runtime > 0n ? (
                      `Lasts ${describeDuration(runtime)} at this rate. The stream stops when it runs out; top up any time, and anything unstreamed comes back if you stop.`
                    ) : (
                      "The whole stream runs from this pot. It stops when the pot is empty; top up any time, and anything unstreamed comes back if you stop."
                    )
                  }
                >
                  <input
                    name="deposit"
                    inputMode="decimal"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                    placeholder={perPeriod.trim() || "500"}
                  />
                </Field>
              </>
            )}
            <label className="hold-option">
              <input
                type="checkbox"
                name="hold"
                checked={hold}
                onChange={(e) => setHold(e.target.checked)}
              />
              <span>
                <strong>Hold until they accept</strong>
                <small className="muted">
                  Nothing streams until the recipient accepts the terms and you start it. Take
                  everything back any time before then. Without this, money streams from the
                  moment you create, and what has streamed is theirs even if they never withdraw
                  it. One extra wallet step.
                </small>
              </span>
            </label>
          </div>
          <div className="form-surface">
            <h2>What for</h2>
            <Field
              error={fieldError("terms")}
              label="What are they delivering, by when?"
              hint={`${termsBytes}/${TERMS_LIMIT} characters. Stored with the stream, word for word. If you ever disagree, five reviewers read exactly this.`}
            >
              <textarea
                name="terms"
                rows={6}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Design and deliver the new landing page (Figma + exported assets) by Friday 24 October. Two rounds of revisions included."
              />
            </Field>
            <details className="helper">
              <summary>More details (optional)</summary>
              <Field
                error={fieldError("link")}
                label="Link to the full agreement"
                hint="For longer terms: a public document the reviewers can open. Saved with the text above."
              >
                <input
                  name="link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://… or ipfs://…"
                />
              </Field>
              <Field
                error={fieldError("imdJobId")}
                label="IMD job"
                hint="If this stream pays for an IMD swarm job, paste its id to link them."
              >
                <input
                  name="imdJobId"
                  value={job}
                  onChange={(e) => setJob(e.target.value)}
                  placeholder="Job id"
                />
              </Field>
            </details>
          </div>
          <div className="form-end">
            {error && <Notice error>{error}</Notice>}
            <p>
              You stay in control of the pace and of anything that has not
              streamed yet. There is no fee.
            </p>
            <button
              className="primary"
              type="submit"
              disabled={!account || !eligible.data || eligible.isError}
            >
              Check it over
            </button>
          </div>
        </form>
      )}
    </>
  );
}
