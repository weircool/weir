import { useState } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { LINKS } from "./config";
import { useBalance, useRead, useRuntime, useStream, useToken } from "./data";
import { tryAmount, units } from "./domain";
import { ApprovalAction } from "./actions";
import { External, Field, Notice, QueryState } from "./ui";
import { Town } from "./Town";

export function Eligibility({ compact = false }: { compact?: boolean }) {
  const r = useRuntime();
  const { address } = useAccount();
  const balance = useBalance(r.token.address, address);
  const token = useToken(r.token.address);
  const eligible = useRead<boolean>("canUse", [address], !!address);
  const tier = useRead<number>("tierBps", [address], !!address);
  return (
    <div className={`eligibility ${compact ? "compact" : ""}`}>
      <div>
        <h2>{compact ? "Can you use Weir?" : "Ready to start a stream?"}</h2>
        {!address ? (
          <p className="muted">
            Connect your wallet to see whether you hold enough WEIR.
          </p>
        ) : (
          <>
            <div className="wallet-stats">
              <div>
                <span>WEIR balance</span>
                <strong className="numeric">
                  {balance.data !== undefined && token.data
                    ? units(balance.data, token.data.decimals)
                    : "Reading…"}
                </strong>
              </div>
              <div>
                <span>Access</span>
                <strong>
                  {eligible.data === undefined
                    ? "Reading…"
                    : eligible.data
                      ? "Yes, you hold enough"
                      : "Not yet: hold 10,000 WEIR"}
                </strong>
              </div>
              <div>
                <span>Deposit if you dispute</span>
                <strong>
                  {tier.data === undefined
                    ? "Reading…"
                    : `${tier.data / 100}% of stake`}
                </strong>
              </div>
            </div>
            <QueryState query={eligible} />
            <QueryState query={balance} />
          </>
        )}
      </div>
      {compact ? (
        <External href={LINKS.token(r.token.address)} className="button">
          Buy WEIR
        </External>
      ) : (
        <a href="#/create" className="button primary">
          Start a stream <span aria-hidden="true">↗</span>
        </a>
      )}
    </div>
  );
}
export function Home() {
  const r = useRuntime();
  const fund = useRead<bigint>("courtFund");
  const minHold = useRead<bigint>("minHold");
  const imd = useRead<Address>("imd");
  const imdToken = useToken(imd.data);
  const weirToken = useToken(r.token.address);
  const [sponsor, setSponsor] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const sponsorAmount = imdToken.data
    ? tryAmount(sponsor, imdToken.data.decimals)
    : undefined;
  const platesOnly = new URLSearchParams(location.search).get("plates") === "1";
  const first = useStream(1n);
  const firstToken = useToken(first.data?.stream.token);
  const figures =
    first.data && firstToken.data && first.data.stream.state === 1
      ? {
          streamed: units(first.data.streamed, firstToken.data.decimals, 2),
          symbol: firstToken.data.symbol,
        }
      : undefined;
  return (
    <>
      <Town route="/" platesOnly={platesOnly} figures={figures} />
      <div className="page-inner">
      <Eligibility />
      <div className="home-grid">
        <section className="hold-section">
          <div className="section-heading">
            <h2>Hold WEIR to use Weir.</h2>
            <External href={LINKS.token(r.token.address)}>Buy WEIR</External>
          </div>
          <p>
            Hold at least{" "}
            <strong>
              {minHold.data !== undefined && weirToken.data
                ? units(minHold.data, weirToken.data.decimals)
                : "10,000"}{" "}
              WEIR
            </strong>{" "}
            to start a stream or raise a dispute. There is no fee. The more you
            hold, the smaller the deposit you put down when you dispute.
          </p>
          <table>
            <caption>Dispute deposit by WEIR held</caption>
            <thead>
              <tr>
                <th scope="col">WEIR held</th>
                <th scope="col">Deposit when you dispute</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Under 100,000</td>
                <td>5%</td>
              </tr>
              <tr>
                <td>100,000+</td>
                <td>2.5%</td>
              </tr>
              <tr>
                <td>1,000,000+</td>
                <td>1%</td>
              </tr>
              <tr>
                <td>10,000,000+</td>
                <td>0%</td>
              </tr>
            </tbody>
          </table>
          <small className="muted">
            A share of what is still inside the stream, paid in the stream’s
            token. You get it back if the reviewers side with you.
          </small>
        </section>
        <section className="court-section">
          <div className="section-heading">
            <h2>The court fund</h2>
            <span className="status-dot" aria-hidden="true" />
          </div>
          <p className="fund-value numeric">
            {fund.data !== undefined && imdToken.data
              ? units(fund.data, imdToken.data.decimals)
              : "…"}{" "}
            <span>{imdToken.data?.symbol ?? "IMD"}</span>
          </p>
          <p>
            Reviewers cost 0.5 IMD per dispute. When this fund holds enough, it
            pays; when it is short, the person who disputes pays.
          </p>
          <Notice>
            Anyone holding 10,000 WEIR can use this fund. Each dispute costs the
            person raising it 20% of the fee, and the fund covers the rest for
            at most five disputes a day. Add only what you are happy to give
            away.
          </Notice>
          <QueryState query={fund} />
          <button
            disabled={busy}
            onClick={() => setShow(!show)}
            aria-expanded={show}
          >
            Sponsor the court fund{" "}
            <span aria-hidden="true">{show ? "−" : "+"}</span>
          </button>
          {show && (
            <div className="sponsor-form">
              <Field
                label={`Sponsorship (${imdToken.data?.symbol ?? "IMD"})`}
                hint="Sponsorship cannot be withdrawn."
              >
                <input
                  inputMode="decimal"
                  value={sponsor}
                  onChange={(e) => setSponsor(e.target.value)}
                  placeholder="Amount"
                  disabled={busy}
                />
              </Field>
              <QueryState query={imdToken} />
              {sponsorAmount && imdToken.data ? (
                <ApprovalAction
                  token={imdToken.data}
                  amount={sponsorAmount}
                  name="sponsor"
                  args={[sponsorAmount]}
                  label="Sponsor"
                  onBusy={setBusy}
                />
              ) : (
                <small className="muted">
                  Enter a positive amount to review the approval.
                </small>
              )}
            </div>
          )}
        </section>
      </div>
      <section className="how-section">
        <h2>Three stops.</h2>
        <div className="three-columns">
          <div>
            <h3>No. 1 Agree</h3>
            <p>
              Write what is being delivered and by when. It is saved with the
              stream, word for word, and the other side can accept it.
            </p>
          </div>
          <div>
            <h3>No. 2 Fund</h3>
            <p>
              Put in a deposit and set an amount per day. Money moves every
              second; they withdraw any time, you can pause or add more.
            </p>
          </div>
          <div>
            <h3>No. 3 Settle</h3>
            <p>
              If you disagree, either side asks five independent reviewers. Four
              must agree. Delivered: the stream resumes. Not delivered: what is
              left comes back to you.
            </p>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
