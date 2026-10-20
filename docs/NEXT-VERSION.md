# Notes for the next Weir contract version

Decisions and open ideas collected while shipping v2 (2026-10-15). None of these are in the v2 contract deployed from commit `291fe2f`.

## Hold gate and bond tiers
- **Minimum hold.** v2 uses 10,000 WEIR (about 0.025 IMD at the 2026-10-15 pool price of roughly 0.0000025 IMD per WEIR). DECIDED for the next version: 100,000 WEIR (confirmed by the owner after being told: the smallest and most common airdrop allocation is 90,090, so 100,000 shuts out 240 of the 339 airdrop wallets (only 99 qualify; 90,000 would admit all 339). The launch's swarm allocation went to 339 wallets; the smallest and median allocation is 90,090 WEIR, the largest about 4.59M. A 90,000 minimum admits every one of them and costs an outsider about 0.23 IMD.
- **The gate is a speed bump, not a cost.** Holdings are not locked, so the real cost of using it is the pool's round-trip fee (about 2.5%) and tokens can serve many wallets in turn. The protections that cost an attacker something are the non-refundable 20% fee share and the five-per-day subsidy limit.
- **Tier thresholds float with the token price.** 100,000 / 1M / 10M WEIR are about 0.25 / 2.5 / 25 IMD today, so a small position gets a zero bond. Reset them to match where holders actually sit (the median airdrop is 90,090, just under the first tier), or add a fixed minimum bond in IMD that does not depend on WEIR's price. Any change is a contract change and needs its own audit.
- **Open question:** how many of the 339 airdrop wallets have actually claimed? The launch record shows no claims.

## Stranded funds: accept gate and reclaim
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

