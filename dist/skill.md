---
name: weir
description: Pay or get paid per second for agreed work on Robinhood Chain, with a reviewer-panel dispute court. Use when an agent needs to fund, monitor, withdraw from or dispute a Weir stream.
---

# Weir for agents

Weir streams an ERC-20 token from a **client** to a **recipient** every second under written **terms**. Either side can **dispute**; the stream pauses and five independent reviewers (the IdentityMD oracle, quorum four) answer one question: *has the recipient delivered the work those terms describe to the standard a reasonable client would accept?* The contract enforces the answer. Nobody is in the middle: no owner, no admin, no fee, no upgrade path. **Not audited.**

- Chain: Robinhood Chain, id **4663**. Gas is ETH.
- Contract `Weir`: `0xde049547f1e55bb093e14d8f4545d1cc9b613f97`
- Token `WEIR`: `0x58b82fa656ecf47a0dca5be6bad06b92e22f7dbe` (18 decimals)
- Oracle fee token `IMD`: `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127` (18 decimals)
- Machine manifest: `agent.json` beside this file. ABI: `abi/Weir.json`.

## Before anything

1. **Hold 10,000 WEIR** in the signing wallet. Creating a stream or raising a dispute reverts with `HoldRequired` otherwise. Holdings are not locked. Buy on the WEIR/IMD pool via explorer.imd.fun. Check with `canUse`.
2. **Hold ETH** on chain 4663 for gas.
3. **Hold the stream token** (USDG for dollars, or WEIR, IMD, WETH, any exact-transfer ERC-20) for the deposit, and **IMD** if you may dispute.

## Use the SDK or MCP, not raw calls

```sh
npm i weir-agent
```

```ts
import { createWeir } from "weir-agent";
const weir = createWeir({ privateKey: process.env.WEIR_PRIVATE_KEY });
const { id } = await weir.createStream({
  recipient: "0x…", token: "USDG", perDay: "40", deposit: "120",
  terms: "Deliver a Python script that dedupes contacts.csv by email, with tests, by 2026-10-20 UTC. Accepted when tests pass on the sample file.",
  jobId: "<imd job uuid, optional>",
});
```

MCP (stdio), for Claude Code, Cursor, or any MCP host:

```json
{ "mcpServers": { "weir": { "command": "npx", "args": ["-y", "weir-agent", "weir-mcp"],
  "env": { "WEIR_PRIVATE_KEY": "0x…" } } }
}
```

Omit the key for read-only tools. The SDK simulates every write first, approves exact amounts, and decodes reverts into plain messages.

## Lifecycle

| Who | Action | Notes |
|---|---|---|
| client | `createStream` | recipient, token, per-day rate, deposit, terms, optional job id |
| recipient | `accept(id)` | optional assent; after it, rulings count in both records |
| client | `deposit`, `pause`, `restart`, `adjust`, `refund`, `void` | refund returns only what has not streamed |
| recipient | `withdraw(id)` | any time, what has streamed so far |
| either | `dispute(id, note)` | pauses the stream, asks the reviewers |
| anyone | `enforce(id)` after a ruling, `expireDispute(id)` after 7 days | |

Amounts: `streamed = min(deposited, rate × elapsed)`; `withdrawable = streamed − withdrawn`; `refundable = balance − streamed`.

## Writing terms

Reviewers see the on-chain `termsURI` text verbatim, nothing else. Make it judgeable:

- **What**: the deliverable, concretely.
- **When**: a UTC deadline.
- **How judged**: the acceptance test a stranger could apply.

Keep it under 512 bytes (about 80 words). Longer: pass the full text as `terms` (it is hashed) and a summary plus a public URL as `termsURI`.

## Disputing

- Quote first: `quoteDispute(id, note)` returns the bond, the fee, and the exact question the reviewers will see.
- **Bond**: `stake × tier`. Tier by the disputer's WEIR balance: under 100k → 5%, 100k+ → 2.5%, 1M+ → 1%, 10M+ → 0%. The loser's bond goes to the other party. Returned if the panel fails or the dispute expires.
- **Fee**: 0.5 IMD at launch (read `oraclePrice`). You pay at least 20% yourself. The court fund covers the rest only if it holds enough and has subsidised fewer than 5 disputes today. The fee is spent even if the panel cannot agree.
- Note ≤ 280 bytes. State the evidence (links, hashes) plainly.
- Ruling **delivered** → stream resumes at its old rate. **Not delivered** → stream closes, unstreamed funds return to the client, recipient keeps what streamed.
- Rulings arrive in minutes to hours. `waitForRuling(id, { autoEnforce: true })` polls and enforces.

## Guardrails for agents

- Never create a stream to yourself. Never approve more than the exact amount (the SDK does not).
- Read `stream(id)` before every action; state changes (pause, dispute, close) make most calls revert with `WrongState`.
- A stream to a token that blocklists the payee can lock that stream. Prefer USDG, WEIR, IMD, WETH.
- Old streams on the previous contract (`0x320de…0d32`) are not visible here. The SDK can read them with `createWeir({ address, deployedBlock })`.
- `streamsOf` and `activity` scan events from the deployment block. On public RPC a long history takes a minute or two; pass `fromBlock` when you know it, and keep your own stream ids.
- Links: stream page `https://weir.cool/#/stream/<id>` (frozen IMD copy: `https://weir.sites.imd.fun`), oracle requests `https://explorer.imd.fun/oracle?q=Weir%20stream%20<id>%20at%20<contract>`, tx `https://robin.etherscan.io/tx/<hash>`.
