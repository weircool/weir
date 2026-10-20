# Notes for the next Weir contract version

Decisions and open ideas collected while shipping v2 (2026-10-15). None of these are in the v2 contract deployed from commit `291fe2f`.

## Hold gate and bond tiers
- **Minimum hold.** v2 uses 10,000 WEIR (about 0.025 IMD at the 2026-10-15 pool price of roughly 0.0000025 IMD per WEIR). DECIDED for the next version: 100,000 WEIR (confirmed by the owner after being told: the smallest and most common airdrop allocation is 90,090, so 100,000 shuts out 240 of the 339 airdrop wallets (only 99 qualify; 90,000 would admit all 339). The launch's swarm allocation went to 339 wallets; the smallest and median allocation is 90,090 WEIR, the largest about 4.59M. A 90,000 minimum admits every one of them and costs an outsider about 0.23 IMD.
- **The gate is a speed bump, not a cost.** Holdings are not locked, so the real cost of using it is the pool's round-trip fee (about 2.5%) and tokens can serve many wallets in turn. The protections that cost an attacker something are the non-refundable 20% fee share and the five-per-day subsidy limit.
- **Tier thresholds float with the token price.** 100,000 / 1M / 10M WEIR are about 0.25 / 2.5 / 25 IMD today, so a small position gets a zero bond. Reset them to match where holders actually sit (the median airdrop is 90,090, just under the first tier), or add a fixed minimum bond in IMD that does not depend on WEIR's price. Any change is a contract change and needs its own audit.
- **Open question:** how many of the 339 airdrop wallets have actually claimed? The launch record shows no claims.

## v3 design: locked escrow with a jury (owner, 2026-10-20)

Decided direction for the next contract, replacing the "Stranded funds" notes below (kept for the record). Prompted by two things seen on v2 in October: a recipient who never withdrew stranded the streamed part, and the realisation that a client can `void` at any moment, so a recipient has no claim on anything not yet streamed and no dispute path once the client has left. v2 protects the client; v3 protects both.

Principle: funds lock only when both parties have signed. Once locked, each side may give money away alone (client releases, recipient refunds), nobody may take it back alone, and the panel decides anything contested. Silence rules stop either side holding the other hostage without paying for a panel.

### Two modes, one state machine

- **Milestone.** A fixed pot for one deliverable with a deadline. Released whole. A job with several parts is several milestones.
- **Stream.** The pot pays out per second from the moment it locks, as v2 does, for retainers and hourly work. The difference from v2: after the lock the client cannot pause, refund or void. Exit is by dispute, and a rejected ruling returns only the unstreamed part.

States: `Pending → Locked → (Delivered) → Disputed → Ruled → Closed`, with `Closed` reachable from `Pending`, `Locked` and `Delivered` as listed below.

### Pending (client funded, recipient has not signed)
- `create(recipient, token, amount, mode, rate, deadline, termsHash, termsURI, imdJobId)`: client funds the whole pot. No clock in either mode. Replaces today's create-then-pause hold, which costs a second transaction and streams for the seconds in between.
- `cancel(id)` by the client: full refund, `Closed`. The only exit; the recipient has signed nothing.
- `accept(id)` by the recipient: `Locked`. The stream clock, if any, starts here. Records count from here, as in v2.
- DECIDED (owner, 2026-10-20): a `Pending` offer expires after `pendingExpiry` (30 days). After that, `accept` reverts, so a recipient cannot lock a stale offer the client forgot about, and `cancel` may be called by anyone, not only the client, so the pot goes back to the client's wallet even if the client never returns. Before the window the client alone may cancel, as above.

### Locked (both signed)
- `release(id)` by the client: 100% of what remains to the recipient, `Closed`. One signature; it only hurts the signer.
- `refund(id)` by the recipient: 100% of what remains to the client, `Closed`. Same logic, the recipient backing out.
- `deposit(id)` by the client: top up (stream mode mainly). Allowed; it only adds to what the recipient may earn.
- Stream mode only: `withdraw` by the recipient of what has streamed, any time, any state, as in v2.
- `deliver(id)` by the recipient: marks the work handed over, `Delivered`, starts the client's response window. Milestone mode needs it; in stream mode it is optional and only matters for the silence rule.
- No `pause`, `adjust`, `void` or client `refund` after the lock. Changing the rate is a new stream.
- `dispute(id, note, maxBond)` by either party, as in v2: bond, oracle fee, panel of five, quorum four, same question. `Disputed` freezes the stream clock.

### Delivered (recipient says it is done)
- Client has `responseWindow` (7 days) to `release` or `dispute`.
- After the window, `claim(id)` by the recipient (or anyone) pays the recipient 100% of what remains, `Closed`. Silence after delivery pays the worker.

### Silence the other way (client protection)
- Milestone mode: if `deadline + graceWindow` (7 days) passes with no `deliver` and no dispute, `reclaim(id)` by the client (or anyone) returns 100% of what remains, `Closed`. Silence past the deadline refunds the client.
- Stream mode: the deadline is optional; when set, the same rule returns the unstreamed part.
- A recipient who is late but working must `deliver` (even partially, with a note in the evidence room) or `dispute` before the grace window ends. Both windows are long enough that the other side can always dispute first.

### Rulings
- Delivered: 100% of what remains to the recipient, `Closed`. (Stream mode: the clock does not restart; the pot is paid out. Keeping v2's "restart at the paused rate" adds states for no gain once release is one click.)
- Not delivered: 100% of what remains to the client, `Closed`. Stream mode: streamed-so-far stays the recipient's; the panel cannot claw back what was already earned by the clock.
- Panel failure or `disputeTimeout` (7 days): back to the state before the dispute, bond returned, as in v2. The response and grace windows are paused while a dispute is open.
- The question stays bool with the v2 template; the panel decides the whole remaining pot one way. No split rulings (`answerType` is bool and splits invite horse-trading). Granularity comes from milestones.

### Bonds and fees
- Bond = remaining pot × tier bps, same tiers as v2 (revisit thresholds per "Hold gate and bond tiers" above). In milestone mode the whole pot is at stake, so bonds are larger in absolute terms than on a half-streamed v2 stream; the tier table may want a lower top rate (2.5% instead of 5%).
- Oracle fee and court fund unchanged.
- Loser's bond to the winner, as in v2.

### Windows and constants
| name | value | purpose |
| --- | --- | --- |
| `responseWindow` | 7 days | client's time to release or dispute after `deliver` |
| `graceWindow` | 7 days | after the deadline, before the client may `reclaim` |
| `disputeTimeout` | 7 days | as v2 |
| `pendingExpiry` | 30 days | after this, `accept` reverts and anyone may `cancel` the unaccepted offer back to the client |

All immutable constructor arguments, as in v2. No owner, no admin, no upgrade path.

### Site
- Create: a Milestone / Stream toggle. Milestone asks for amount, deadline, terms. Stream asks for rate, deposit, optional deadline. Both say in plain words what locks and when it can come back.
- Stream page per state: Pending shows "waiting for them to accept" with cancel; Locked shows release / refund / deliver / dispute; Delivered shows the client's countdown; after windows, the one-click claim or reclaim.
- Evidence room per stream (see the dispute notes in PRODUCT.md): deliver and dispute both link to it. Decide after the 0.5 IMD test whether the panel opens links.
- Terms template on Create: deliverable, due date, acceptance criteria, link to the spec.

### Costs and sequencing
- New contract, not an edit: v2 is 43 bytes under the size cap. Drop `pause`/`adjust`/`restart` and the paused-rate bookkeeping to make room for `deliver`/`claim`/`reclaim`/`release`.
- Needs its own audit and the hostile-token tests from "Contract hygiene".
- Before writing Solidity: run one throwaway dispute on v2 with a link in the note to confirm the panel reads off-chain evidence (open item in WEIR-PLAN.md). If it does not, the ruling step needs IMD-side work first.
- v2 streams stay on v2; the site must keep reading both contracts.

## Stranded funds: accept gate and reclaim (superseded by the v3 design above)
Seen on 2026-10-20: a client streamed a small amount to a recipient who then declined to withdraw it. Once streamed, the amount belongs to the recipient alone (`withdraw` is recipient-only, allowed in any state, never expires) and the client has no path back to it. The site now works around this by pausing right after create ("Hold until they accept"), which costs a second transaction and streams for the few seconds in between.
- **Accept gate (DECIDED as the design, not yet built).** Create a stream in a `Pending` state with no clock. The clock starts at `accept(id)` (or at the recipient's first `withdraw`/`dispute`, which already count as acceptance). The client may `cancel` a pending stream for a full refund. A recipient who never engages never earns anything, and the hold needs no second transaction.
- **Reclaim after long silence (open).** If a `Closed` stream still has `withdrawable(id) > 0` after a long window (a year), let the client `reclaim(id)`. Covers a recipient who vanishes after the work. Weakens "the recipient keeps what streamed", so keep the window long and show it on every surface.
- Both are contract changes: size budget (see Contract hygiene) and a new audit apply.

## Oracle signer
Keep it immutable. A changeable signer needs an admin who could decide every dispute. If IMD rotates its key, new rulings stop verifying, disputes fall back to expiry and bonds come back, and a redeploy rotates it. The Intake's published `signer()` is its quote-signing key, not the attestation key, so there is no on-chain value to follow.

## Court fund
- Disputer share 20% and five subsidised disputes per UTC day are constants. A fixed UTC-day window lets ten disputes through around midnight. A rolling window or a smaller daily limit would tighten it.
- Alternative design: sponsors fund a specific stream's dispute fee instead of a shared pool, which strangers cannot drain. It removes the "court fund" feature.

## Contract hygiene
- The Weir runtime is 24,533 bytes against the 24,576 limit (optimizer_runs 1). Any addition needs trimming first; the two subsidy counters stayed internal for this reason.
- Make the next version smaller before adding features, or split the oracle consumer into a library.
- Hostile-token tests from day one: gas-burning `transfer` and `balanceOf`, false and non-bool returns.
- Always get an independent review of the fixes themselves. The two Low findings in the v2 review were introduced while fixing v1.

## Process
- Check size caps (IMD allows 8 MiB of unique git blobs per job), allowed paths and the hosting field in any paid request before paying.
- A redeploy against the same WEIR token needs no new token or pool, but it is a new address with empty state; old streams stay on the old contract and users must switch.

## Open items from the v2 deploy audit (launch 1869, 0 medium or above)
- **Low:** `expireDispute` is permissionless and the attestation stays valid for the same 7 days, so the losing party could void a dispute by expiring it one block before a late but valid ruling lands. Fix: add a grace period after the timeout, or make attestations valid for less than the timeout.
- **Low:** a permissionless `enforce` of an accepted ruling resumes a stream the client had paused before the dispute. Documented as intended; revisit if clients object.
- **Info:** the unbounded `dispute(id, note)` overload lets a client inflate the recipient's bond by front-running with a deposit (bounded overload is the remedy); the bond rounds to zero for tiny stakes; the README's "Launch token" section still describes a factory-minted token.
- **Not checked offline:** the live Intake's acceptance of the `consumer` key shape in the request body (v1 sent the same key and a real dispute went through), and callback gas if the oracle signer is a contract and not a key.

