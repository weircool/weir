import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { zeroHash, type Address } from "viem";
import {
  useRead,
  useReady,
  useRuntime,
  useStream,
  useToken,
  type Token,
} from "./data";
import { LINKS } from "./config";
import {
  displayJob,
  permissions,
  safeUri,
  stateLabel,
  tryAmount,
  UINT128_MAX,
  units,
  type Stream,
  clearHoldIntent,
  holdIntentKey,
} from "./domain";
import { Action, ApprovalAction, Claim } from "./actions";
import { DisputeDialog } from "./Dispute";
import { OracleRequestLink } from "./OracleLink";
import { RecordCard } from "./Records";
import { AddressView, External, Field, Notice, QueryState, Title } from "./ui";
import { useStreamEvents } from "./history";
import { ConnectPrompt } from "./Wallet";

function History({ id }: { id: bigint }) {
  const r = useRuntime();
  const q = useStreamEvents(id);
  const events =
    q.data?.pages
      .flatMap((p) => p.events)
      .sort(
        (a, b) =>
          Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex,
      ) ?? [];
  return (
    <section className="history">
      <h2>History</h2>
      <QueryState query={q} />
      {events.length === 0 && !q.isPending && (
        <p className="muted">No events in the scanned blocks.</p>
      )}
      <ol className="event-list">
        {events.map((e) => (
          <li key={`${e.transactionHash}-${e.logIndex}`}>
            <div>
              <strong>{e.eventName.replace(/([a-z])([A-Z])/g, "$1 $2")}</strong>
              <span className="muted">Block {e.blockNumber.toString()}</span>
            </div>
            <External
              href={`${r.deployment.network.explorer}/tx/${e.transactionHash}`}
            >
              Transaction
            </External>
            {e.eventName === "QuestionCommitted" && (
              <details>
                <summary>Read the paid question</summary>
                <p className="question">{String(e.args.question)}</p>
                <p className="hash">
                  Question hash: {String(e.args.questionHash)}
                </p>
              </details>
            )}
            {e.eventName === "Disputed" && (
              <p>
                {e.args.fundPaid
                  ? "The court fund paid the oracle fee."
                  : "The caller paid the oracle fee."}
              </p>
            )}
            {e.eventName === "Verdict" && (
              <p>
                {e.args.accepted
                  ? "Recipient’s work accepted."
                  : "Recipient’s work rejected."}{" "}
                <External
                  href={LINKS.job(
                    displayJob(e.args.panelJobId as `0x${string}`),
                  )}
                >
                  Panel job
                </External>
              </p>
            )}
          </li>
        ))}
      </ol>
      {q.data && (
        <p className="muted">
          Scanned blocks {q.data.pages.at(-1)!.from.toString()}–
          {q.data.pages[0].to.toString()}.
        </p>
      )}
      {q.hasNextPage && (
        <button disabled={q.isFetching} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage
            ? "Reading older events…"
            : "Load older activity"}
        </button>
      )}
    </section>
  );
}
function StreamActions({
  id,
  stream,
  token,
  withdrawable,
  refundable,
  acceptedAt,
}: {
  id: bigint;
  stream: Stream;
  token: Token;
  withdrawable: bigint;
  refundable: bigint;
  acceptedAt: bigint;
}) {
  const { address } = useAccount();
  const access = permissions(stream, address);
  const gate = useReady();
  // Active but paused: either a client pause or a stream created on hold until the recipient accepts.
  const held = stream.state === 1 && stream.rate === 0n;
  // The client chose "hold until they accept" on this browser, but the pause never confirmed.
  const [holdMissed, setHoldMissed] = useState(() => {
    try {
      return localStorage.getItem(holdIntentKey(id)) !== null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (holdMissed && held) {
      clearHoldIntent(id);
      setHoldMissed(false);
    }
  }, [holdMissed, held, id]);
  const [depositInput, setDepositInput] = useState("");
  const [rate, setRate] = useState("");
  const [ratePeriod, setRatePeriod] = useState<"day" | "week">("day");
  const [refund, setRefund] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const depositAmount = tryAmount(depositInput, token.decimals);
  // The form takes an amount per day or week; the contract stores units per second.
  const PERIOD = { day: 86400n, week: 604800n } as const;
  const perPeriod = tryAmount(rate, token.decimals, UINT128_MAX);
  const rateAmount =
    perPeriod !== undefined && perPeriod / PERIOD[ratePeriod] > 0n
      ? perPeriod / PERIOD[ratePeriod]
      : undefined;
  const currentRate = stream.rate > 0n ? stream.rate : stream.pausedRate;
  const perDay = (r: bigint) => `${units(r * 86400n, token.decimals)} ${token.symbol} per day`;
  const refundAmount = tryAmount(refund, token.decimals);
  const withdrawAmount = tryAmount(withdraw, token.decimals);
  const claimable = useRead<bigint>(
    "claimable",
    [stream.token, address],
    !!address,
  );
  return (
    <>
      {!address ? (
        <ConnectPrompt />
      ) : (
        <>
          {!gate.ready && <Notice>{gate.reason}</Notice>}
          {access.client && (
            <section className="controls-section">
              <h2>You are the client</h2>
              {holdMissed && stream.state === 1 && stream.rate > 0n && (
                <section className="notice error hold-start" role="alert">
                  <h3>Not on hold: this stream is paying out</h3>
                  <p>
                    You chose to hold it until the recipient accepts, but the pause was never
                    confirmed. It is streaming {perDay(stream.rate)} right now
                    {acceptedAt === 0n ? ", and they have not accepted the terms yet" : ""}.
                    Pause it to put it on hold; start it again once they accept.
                  </p>
                  <Action name="pause" args={[id]} label="Pause the stream" />
                </section>
              )}
              {held && acceptedAt === 0n && (
                <Notice>
                  On hold. Nothing streams until you start it. The recipient has
                  not accepted the terms yet; once they do, start the stream here.
                  Until then you can take everything back.
                </Notice>
              )}
              {held && acceptedAt > 0n && stream.pausedRate > 0n && (
                <section className="notice hold-start">
                  <h3>The recipient accepted the terms</h3>
                  <p>
                    Start streaming at the saved rate of{" "}
                    {units(stream.pausedRate * 86400n, token.decimals)} {token.symbol}{" "}
                    per day. Nothing is paid out until you do.
                  </p>
                  <Action
                    name="restart"
                    args={[id, stream.pausedRate]}
                    label="Start streaming"
                  />
                </section>
              )}
              <div className="controls-grid">
                {access.deposit && (
                  <section>
                    <h3>Add money</h3>
                    <Field label={`Deposit (${token.symbol})`}>
                      <input
                        inputMode="decimal"
                        disabled={depositBusy}
                        value={depositInput}
                        onChange={(e) => setDepositInput(e.target.value)}
                        placeholder="Amount"
                      />
                    </Field>
                    {depositAmount ? (
                      <ApprovalAction
                        token={token}
                        amount={depositAmount}
                        name="deposit"
                        args={[id, depositAmount]}
                        label="Deposit"
                        onBusy={setDepositBusy}
                      />
                    ) : (
                      <small className="muted">
                        Enter a positive amount to review the deposit.
                      </small>
                    )}
                  </section>
                )}
                {(access.pause || access.restart) && (
                  <section>
                    <h3>Pause or change the pace</h3>
                    {access.pause && (
                      <Action name="pause" args={[id]} label="Pause" />
                    )}
                    <p className="muted">
                      {stream.rate > 0n
                        ? `Now ${perDay(stream.rate)}.`
                        : currentRate > 0n
                          ? `Saved rate ${perDay(currentRate)}.`
                          : "No saved rate."}
                    </p>
                    <Field
                      label={`${access.restart ? "Rate" : "New rate"} (${token.symbol})`}
                      hint={
                        rateAmount
                          ? `${units(rateAmount, token.decimals)} ${token.symbol} every second, rounded down to the smallest unit. ${perDay(rateAmount)}.`
                          : perPeriod
                            ? `That is less than the smallest unit of ${token.symbol} per second. Raise the amount.`
                            : "What they earn each day or each week while the stream runs."
                      }
                    >
                      <div className="amount-row">
                        <input
                          inputMode="decimal"
                          value={rate}
                          onChange={(e) => setRate(e.target.value)}
                          placeholder={
                            currentRate > 0n
                              ? units(currentRate * PERIOD[ratePeriod], token.decimals)
                              : "Amount"
                          }
                        />
                        <div className="period-toggle" role="radiogroup" aria-label="Per">
                          {(["day", "week"] as const).map((p) => (
                            <button
                              type="button"
                              key={p}
                              role="radio"
                              aria-checked={ratePeriod === p}
                              className={ratePeriod === p ? "selected" : ""}
                              onClick={() => setRatePeriod(p)}
                            >
                              per {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Field>
                    <Action
                      name={access.restart ? "restart" : "adjust"}
                      args={[id, rateAmount ?? 0n]}
                      label={access.restart ? "Restart at this rate" : "Change the rate"}
                      disabled={!rateAmount}
                    />
                  </section>
                )}
                {access.refund && (
                  <section>
                    <h3>Take back what has not streamed</h3>
                    <p>
                      {units(refundable, token.decimals)} {token.symbol}{" "}
                      refundable now.
                    </p>
                    <Field label={`Refund amount (${token.symbol})`}>
                      <input
                        inputMode="decimal"
                        value={refund}
                        onChange={(e) => setRefund(e.target.value)}
                        placeholder="Amount"
                      />
                    </Field>
                    <div className="action-row">
                      <Action
                        name="refund"
                        args={[id, refundAmount ?? 0n]}
                        label="Refund amount"
                        disabled={!refundAmount || refundAmount > refundable}
                      />
                      <Action
                        name="refundMax"
                        args={[id]}
                        label="Refund max"
                        disabled={refundable === 0n}
                        confirm="Refund all funds that have not streamed when this transaction confirms. Earned funds stay available to the recipient."
                      />
                    </div>
                  </section>
                )}
                {access.void && (
                  <section>
                    <h3>Stop the stream</h3>
                    <p>
                      Voiding ends the stream and refunds unearned funds. The
                      recipient keeps what has streamed.
                    </p>
                    <Action
                      name="void"
                      args={[id]}
                      label="Stop and take back the rest"
                      danger
                      confirm="This permanently closes the stream. Unearned funds go to the client; the recipient can still withdraw earned funds."
                    />
                  </section>
                )}
                {!access.deposit && !access.void && (
                  <p className="muted">
                    No client changes are available while the stream is{" "}
                    {stateLabel(stream).toLowerCase()}.
                  </p>
                )}
              </div>
            </section>
          )}
          {access.recipient && (
            <section className="controls-section">
              <h2>You are the recipient</h2>
              {held && acceptedAt === 0n && (
                <Notice>
                  The client is holding this stream until you accept the terms.
                  Nothing streams yet. Accept below and they can start it.
                </Notice>
              )}
              {acceptedAt === 0n && stream.state === 1 && (
                <section className="terms-preview">
                  <h3>Read this before you accept or withdraw</h3>
                  <p className="muted">
                    Reviewers read exactly these words. Withdrawing also accepts
                    them.
                  </p>
                  <p className="terms-quote">
                    {safeUri(stream.termsURI) ?? stream.termsURI}
                  </p>
                </section>
              )}
              <div className="controls-grid">
                <section>
                  <h3>Withdraw what has streamed</h3>
                  <p>
                    {units(withdrawable, token.decimals)} {token.symbol}{" "}
                    available now.
                  </p>
                  <Field label={`Withdrawal amount (${token.symbol})`}>
                    <input
                      inputMode="decimal"
                      value={withdraw}
                      onChange={(e) => setWithdraw(e.target.value)}
                      placeholder="Amount"
                    />
                  </Field>
                  <div className="action-row">
                    <Action
                      name="withdraw"
                      args={[id, withdrawAmount ?? 0n]}
                      label="Withdraw amount"
                      disabled={
                        !withdrawAmount || withdrawAmount > withdrawable
                      }
                    />
                    <Action
                      name="withdrawMax"
                      args={[id]}
                      label="Withdraw max"
                      disabled={withdrawable === 0n}
                    />
                  </div>
                  {acceptedAt === 0n && (
                    <p className="muted">
                      Withdrawing also accepts the terms, allowing future
                      rulings to count in both parties’ records.
                    </p>
                  )}
                </section>
                {acceptedAt === 0n && stream.state === 1 && (
                  <section>
                    <h3>Accept the terms</h3>
                    <p>
                      Confirm that you agree to the linked terms and their hash.
                      Future rulings will count in both parties’ records.
                    </p>
                    <Action
                      name="accept"
                      args={[id]}
                      label="Accept terms"
                      confirm="Accept the terms linked on this stream. A future ruling will be recorded against both parties. This acceptance cannot be removed."
                    />
                  </section>
                )}
              </div>
            </section>
          )}
          {claimable.data !== undefined && claimable.data > 0n && (
            <section className="notice">
              <h2>A payment is waiting for you</h2>
              <p>
                The token previously refused a settlement payout. You can claim{" "}
                {units(claimable.data, token.decimals)} {token.symbol} when it
                allows transfers.
              </p>
              <Claim token={token} />
            </section>
          )}
        </>
      )}
    </>
  );
}
export function StreamPage({ id }: { id: bigint }) {
  const q = useStream(id);
  const token = useToken(q.data?.stream.token);
  const { address } = useAccount();
  const gate = useReady();
  const timeout = useRead<bigint>("disputeTimeout");
  const eligible = useRead<boolean>("canUse", [address], !!address);
  const [dispute, setDispute] = useState(false);
  const [history, setHistory] = useState(false);
  if (!q.data || !token.data)
    return (
      <>
        <Title>Stream #{id.toString()}</Title>
        <QueryState query={q} />
        {q.data && <QueryState query={token} />}
        <a href="#/streams">Back to my streams</a>
      </>
    );
  const {
    stream: s,
    streamed,
    withdrawable,
    refundable,
    acceptedAt,
    timestamp,
  } = q.data;
  const t = token.data;
  const access = permissions(s, address);
  const expiry =
    timeout.data !== undefined
      ? s.disputedAt + BigInt(timeout.data)
      : undefined;
  return (
    <>
      <div className="breadcrumb">
        <a href="#/streams">My streams</a>
        <span aria-hidden="true">/</span>
        <span>#{id.toString()}</span>
      </div>
      <Title
        aside={
          <span className={`badge state-${s.state}`}>{stateLabel(s)}</span>
        }
      >
        Stream #{id.toString()}
      </Title>
      <QueryState query={q} />
      <div className="stream-parties">
        <div>
          <span className="muted">Client</span>
          <AddressView value={s.client} full />
        </div>
        <span className="flow-arrow" aria-hidden="true">
          →
        </span>
        <div>
          <span className="muted">Recipient</span>
          <AddressView value={s.recipient} full />
        </div>
      </div>
      <dl className="stream-metrics">
        <div>
          <dt>Streamed so far</dt>
          <dd>
            {units(streamed, t.decimals)} <span>{t.symbol}</span>
          </dd>
        </div>
        <div>
          <dt>Ready to withdraw</dt>
          <dd>
            {units(withdrawable, t.decimals)} <span>{t.symbol}</span>
          </dd>
        </div>
        <div>
          <dt>Still the client’s</dt>
          <dd>
            {units(refundable, t.decimals)} <span>{t.symbol}</span>
          </dd>
        </div>
        <div>
          <dt>Every second</dt>
          <dd>
            {units(s.rate, t.decimals)} <span>{t.symbol}</span>
          </dd>
        </div>
      </dl>
      <div className="live-read">
        <p className="muted">
          Live reads refresh every 5 seconds. Last read: block{" "}
          {q.data.block.toString()}.
        </p>
        <button disabled={q.isFetching} onClick={() => q.refetch()}>
          {q.isFetching ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
      <section className="terms-section">
        <div className="section-heading">
          <h2>What was agreed</h2>
          <span>
            {acceptedAt > 0n ? "Accepted by the recipient" : "Not accepted yet"}
          </span>
        </div>
        <div className="row-links">
          {safeUri(s.termsURI) ? (
            <External href={safeUri(s.termsURI)!}>Open the agreement</External>
          ) : (
            <p className="terms-text">{s.termsURI}</p>
          )}
          {s.imdJobId !== zeroHash && (
            <External href={LINKS.job(displayJob(s.imdJobId))}>
              View IMD job
            </External>
          )}
          {(access.client || !access.recipient) && (
            <a className="button" href={`#/stream/${id.toString()}/receipt/client`}>
              Payment receipt
            </a>
          )}
          {(access.recipient || !access.client) && (
            <a className="button" href={`#/stream/${id.toString()}/receipt/freelancer`}>
              Proof of contract
            </a>
          )}
          <span>
            Token: {t.symbol} · <AddressView value={s.token} />
          </span>
        </div>
        <details>
          <summary>Details</summary>
          <dl className="detail-list">
            <div>
              <dt>Fingerprint of the terms</dt>
              <dd className="hash">{s.termsHash}</dd>
            </div>
            <div>
              <dt>Terms as stored</dt>
              <dd>{s.termsURI}</dd>
            </div>
            <div>
              <dt>Put in so far</dt>
              <dd>
                {units(s.balance, t.decimals)} {t.symbol}
              </dd>
            </div>
            <div>
              <dt>Already withdrawn</dt>
              <dd>
                {units(s.withdrawn, t.decimals)} {t.symbol}
              </dd>
            </div>
            <div>
              <dt>Still inside the stream</dt>
              <dd>
                {units(s.balance - s.withdrawn, t.decimals)} {t.symbol}
              </dd>
            </div>
            <div>
              <dt>Saved paused rate</dt>
              <dd>
                {units(s.pausedRate, t.decimals)} {t.symbol}/second
              </dd>
            </div>
          </dl>
        </details>
      </section>
      <StreamActions
        id={id}
        stream={s}
        token={t}
        withdrawable={withdrawable}
        refundable={refundable}
        acceptedAt={acceptedAt}
      />
      <section className="dispute-section">
        <h2>Disagree?</h2>
        {s.state === 1 && (
          <>
            <p>
              A client or recipient holding enough WEIR can ask the IdentityMD
              panel to judge the agreed work.
            </p>
            <button
              disabled={!gate.ready || !access.dispute || !eligible.data}
              onClick={() => setDispute(true)}
            >
              Review a dispute
            </button>
            {(access.client || access.recipient) && eligible.data === false && (
              <Notice>
                Hold the required WEIR balance to raise a dispute.
              </Notice>
            )}
          </>
        )}
        {s.state === 2 && (
          <>
            <p>
              The stream is paused while the oracle considers the question.
              Earned funds remain withdrawable.
            </p>
            <OracleRequestLink id={id} stream={s} />
            <p className="hash">Intake receipt: {s.requestId}</p>
            <p>
              Bond in custody: {units(s.bond, t.decimals)} {t.symbol}.
            </p>
            {expiry !== undefined && (
              <p>
                Expiry becomes available strictly after{" "}
                {new Date(Number(expiry) * 1000).toLocaleString()}.{" "}
                {timestamp > expiry
                  ? "The timeout has passed."
                  : "Waiting for the timeout."}
              </p>
            )}
            <QueryState query={timeout} />
            <Action
              name="expireDispute"
              args={[id]}
              label="Close the stale dispute"
              disabled={expiry === undefined || timestamp <= expiry}
              confirm="Release the dispute bond to its poster and clear this request without a verdict. The stream stays paused until the client restarts it. The oracle fee is already spent."
            />
          </>
        )}
        {s.state === 3 && (
          <>
            <p>
              {s.ruling === 1
                ? "The panel accepted the recipient’s work. Enforcing resumes the saved rate."
                : "The panel rejected the recipient’s work. Enforcing closes the stream and refunds unearned funds."}{" "}
              The bond goes to the winning party.
            </p>
            <OracleRequestLink id={id} stream={s} />
            <Action
              name="enforce"
              args={[id]}
              label="Apply the decision"
              confirm={
                s.ruling === 1
                  ? "Apply the accepted ruling, resume the saved rate and pay the bond to the recipient."
                  : "Apply the rejected ruling, close the stream, refund unearned funds and pay the bond to the client."
              }
            />
          </>
        )}
        {s.state === 4 && (
          <p>
            This stream is closed. The recipient can still withdraw earned
            funds.
          </p>
        )}
      </section>
      <section className="parties-records">
        <h2>Track records</h2>
        <div className="two-columns">
          <RecordCard account={s.client} title="Client" />
          <RecordCard account={s.recipient} title="Recipient" />
        </div>
      </section>
      <button aria-expanded={history} onClick={() => setHistory(!history)}>
        {history ? "Hide stream activity" : "Show stream activity"}
      </button>
      {history && <History id={id} />}
      {dispute && (
        <DisputeDialog
          id={id}
          stream={s}
          token={t}
          onClose={() => setDispute(false)}
        />
      )}
    </>
  );
}
