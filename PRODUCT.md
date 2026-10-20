# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: freelancers and the small clients who pay them, for jobs in the $50–$5,000 range (design, code, writing, ops work). They may own a crypto wallet but do not know Ethereum vocabulary beyond "wallet", "token" and "pay". They arrive from a link the other party sent, on a phone or laptop, wanting to see money moving and to feel it is safe.

Secondary (confirmed): IMD swarm operators and agents who run jobs on explorer.imd.fun and want a stream tied to a job id, with links straight to the job and the oracle request. They tolerate density and want the technical details one disclosure away, never removed.

## Product Purpose

Weir. streams payment from a client to a recipient per second against agreed terms. The client funds a stream and can pause, top up, refund what has not streamed, or close it. The recipient withdraws what has streamed, any time. When the two disagree about the work, either side raises a dispute: the stream pauses and a panel of five independent reviewers (the IdentityMD oracle, quorum four) answers one question, "has the recipient delivered the work those terms describe to the standard a reasonable client would accept?" The contract enforces the answer: delivered → the stream resumes; not delivered → the stream closes, unstreamed funds return to the client, the recipient keeps what already streamed. Success: a client funds a stream in under two minutes without reading a glossary, and both parties trust that a dispute is settled by reviewers, not by whoever shouts loudest.

## Positioning

Escrow with a clock and a jury, and no company in the middle. The contract (`Weir`, Robinhood Chain) has no owner, no admin, no pause switch, no fee and no upgrade path; nobody at Weir. can touch a stream. Disputes are settled by an external panel the parties do not choose, paid per question (0.5 IMD), not by a platform support team. Access is by holding the WEIR token (10,000), not by paying a fee; holding more lowers the dispute bond. A neighbouring streaming product (Sablier, Superfluid) cannot truthfully claim the jury; an escrow or freelance marketplace cannot truthfully claim no fee and no middleman.

## Operating Context

- Chain: Robinhood Chain (id 4663). Contracts live: `Weir` 0x320de26e4bc988e0c425531e564ded3d2f730d32, token `WEIR` 0x58b82fa656ecf47a0dca5be6bad06b92e22f7dbe, both deployed by the IMD launch factory (launch 1780, 2026-10-14). The WEIR/IMD pool is on Uniswap v4; "Buy WEIR" links to explorer.imd.fun.
- Wallets: Rabby, MetaMask, other injected wallets, Coinbase Wallet. The site switches or adds the chain. Gas is ETH on Robinhood Chain.
- Disputes pay the IdentityMD Intake in IMD (0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127 on 4663); the live price is read per dispute. A permissionless court fund of IMD pays first when it holds enough; otherwise the disputer pays.
- The oracle request, panel answers and signed attestation are public on explorer.imd.fun / api.imd.fun; a dispute resolved in about five minutes in the first live test (2026-10-15, stream 1).
- The site is a static Vite + React + wagmi export that reads `imd-deployment.json` and the ABI JSON files at runtime and verifies their hashes. IMD hosts a frozen, attested copy at weir.sites.imd.fun; this repository's build is served from https://weir.cool (apex is canonical; www redirects to it, decided 2026-10-16).
- Streams are per-second; the contract stores a rate per second. People think in amounts per day or per week; the UI converts.

## Capabilities and Constraints

- Create a stream: recipient, token (any exact-transfer ERC-20; WEIR offered as default), rate, initial deposit, terms (hash + URI, both stored on-chain), optional IMD job id. The caller must hold ≥ 10,000 WEIR (`minHold`, immutable).
- Terms: `termsURI` is a free string up to 512 UTF-8 bytes and is quoted verbatim to the reviewers; `termsHash` is keccak256 of the terms. The UI may put the terms text itself in `termsURI` (no public URL required) and must compute the hash silently. Longer terms need a public URL or IPFS.
- Client actions: deposit, pause, restart, adjust rate, refund (up to the unstreamed amount), void (close). Recipient: accept terms, withdraw. Either party: dispute (note ≤ 280 bytes). Anyone: enforce a ruling, expire a dispute after 7 days, sponsor the court fund, claim a deferred payout.
- Bond: stake × tier bps (stake = funds still inside the stream). Tiers by the disputer's WEIR balance: <100k → 5%, ≥100k → 2.5%, ≥1M → 1%, ≥10M → 0%. Loser's bond goes to the counterparty; returned on panel failure or timeout. `dispute(id, note, maxBond)` caps the bond.
- Rulings: accepted → stream restarts at its paused rate; rejected → unstreamed funds to the client, recipient keeps what streamed. Records (won/lost as client and as recipient) are written only once the recipient has accepted the terms, withdrawn, or disputed.
- No fee, no admin, no upgrade. Not audited beyond the IMD swarm's five-reviewer panel; every surface must say so plainly. The oracle fee is spent even when the panel cannot agree. Known accepted risk: the court fund can be drained by trivial disputes; a blocklisted payee on a token that returns false can lock that one stream.
- Vocabulary for users: terms, reviewers, deposit, per day, settle, paused, closed. Keep the exact words `hash`, `URI`, `oracle`, `attestation`, `bps`, `tier`, `rate per second`, `enforce` out of primary copy; they may appear inside a "Details" disclosure for the secondary audience.
- Token picker (owner, 2026-10-15): Create offers a short list of named tokens instead of a raw address field: **USDG** (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 6 decimals, the chain's dollar), **WEIR** (0x58b82fa656ecf47a0dca5be6bad06b92e22f7dbe), **IMD** (0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127), plus **ETH** streamed as WETH (0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73; the site wraps for the client in one step, the recipient can unwrap any time) and "another token" by address one disclosure away. Symbol and decimals are still read from the contract. Verified by simulation on 2026-10-15: WETH `deposit` then `withdraw` returns the ETH to the sender on Robinhood Chain (an older note claiming `withdraw()` burns there was wrong for this path).
- Terms live on the site (owner, 2026-10-15): the user writes the terms in one box on Create; the text itself is stored on-chain as `termsURI` (≤ 512 UTF-8 bytes, about 80 words) and `termsHash` is computed silently. Every stream page shows the terms read back from the chain, so "posting" them is automatic and nothing external is needed. Longer terms: the box counts down and offers an optional link field for the full document; the on-chain text then carries the summary plus that link.
- Hold until accepted (owner, 2026-10-20): the clock starts at `createStream`, and streamed funds are the recipient's alone (`withdraw` has no state check and no expiry), so a recipient who never withdraws strands them for good. The contract cannot be changed, so Create offers "Hold until they accept" (on by default): the site calls `pause` right after `createStream`, the stream page tells the recipient to accept and then shows the client a one-click "Start streaming" at the saved rate. Cost: one extra wallet step and the few seconds between the two transactions, which stream at the full rate. A proper fix (no clock before `accept`) is a contract change; see docs/NEXT-VERSION.md.
- Undecided: copy for the "Records" page beyond win/loss counts.

## Brand Commitments

- Name: **Weir.** (product, written with the period; the owner dropped "Pay" on 2026-10-15), **Weir** (contract and token WEIR). A weir is a low barrier that controls a river's flow: the brand's root metaphor is water paced, measured and held back, never dammed.
- Mark: keep the swarm's two-arch line mark (the `<svg viewBox="0 0 64 64">` path in the header) as the logo; it may be re-coloured and resized, not redrawn.
- Voice: plain, calm, specific. No hype, no yield/return/investment language, no promises about price. Say "reviewers" for the panel and "not audited" where relevant.

## Evidence on Hand

- Live contracts and a completed live dispute (stream 1, ruled "not delivered", 4 of 4 reviewers, ~5 minutes): verifiable on explorer.imd.fun and robin.etherscan.io. Use as the demonstration; label any other example data synthetic.
- Launch audit trail: four specialist reviews plus a judge, 159 tests, repo `identity-md-launches/launch-1780-weir`. It is a review, not an audit.
- Assets: the line mark, `web/assets/share.svg`, wallet vendor icons under `web/public/wallets/`. No photography, testimonials, customers, press or benchmarks exist; none may be invented.

## Product Principles

1. Money is visible and reversible until it flows: the client always sees what has streamed and what comes back if they stop.
2. Nobody in the middle: every statement about safety points at the contract and the reviewers, never at the company.
3. Plain words first, exact details one tap away: the primary path has no jargon; the secondary audience is never locked out of the specifics.
4. Trust through specificity: real addresses, real counts, real timing (five reviewers, four must agree, about minutes), never adjectives.
5. The mechanism is the brand: pacing, pausing and settling are what the interface dramatizes.

## Accessibility & Inclusion

Keyboard-operable throughout, visible focus, 16px inputs on phones, every status with text (never colour alone), no horizontal scroll at 320–1440px, motion only under `prefers-reduced-motion: no-preference`. Inherited from the incumbent build and to be kept.
