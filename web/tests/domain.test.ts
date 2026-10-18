import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  encodeErrorResult,
  ContractFunctionRevertedError,
  zeroHash,
  type Address,
} from "viem";
import {
  amount,
  describeDuration,
  UINT128_MAX,
  jobId,
  displayJob,
  safeUri,
  permissions,
  disputeAllowances,
  errorText,
  byteLength,
  type Stream,
} from "../src/domain";
import { hashAbi, type Runtime } from "../src/config";
import { switchProvider } from "../src/Wallet";
const client = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const imd = "0x3333333333333333333333333333333333333333" as Address;
test("6-decimal token amounts retain exact units", () => {
  assert.equal(amount("12.345678", 6), 12345678n);
  assert.equal(amount(" 1.25 ", 6), 1250000n);
  assert.equal(amount("0.000001", 6), 1n);
  for (const value of [
    "0.0000009",
    "-1",
    "1e18",
    "1,000",
    "NaN",
    "0",
    "",
    "1.",
  ])
    assert.throws(() => amount(value, 6));
});
test("contract width is checked before encoding", () => {
  assert.equal(amount(UINT128_MAX.toString(), 0, UINT128_MAX), UINT128_MAX);
  assert.throws(() => amount((UINT128_MAX + 1n).toString(), 0, UINT128_MAX));
});
test("job UUIDs use right-padded bytes32 and round-trip", () => {
  const uuid = "12345678-1234-4abc-8def-123456789abc";
  assert.equal(
    jobId(uuid),
    "0x1234567812344abc8def123456789abc00000000000000000000000000000000",
  );
  assert.equal(displayJob(jobId(uuid)), uuid);
  assert.equal(jobId(""), zeroHash);
  assert.throws(() => jobId("missing"));
});
test("untrusted terms cannot produce executable links", () => {
  assert.equal(safeUri("javascript:alert(1)"), undefined);
  assert.equal(safeUri("data:text/html,<h1>"), undefined);
  assert.equal(
    safeUri("https://example.org/terms"),
    "https://example.org/terms",
  );
  assert.equal(safeUri("ipfs://bafyterms"), "ipfs://bafyterms");
});
test("note limit counts UTF-8 bytes rather than characters", () => {
  assert.equal(byteLength("é".repeat(140)), 280);
  assert.equal(byteLength("é".repeat(141)), 282);
});
test("client and recipient controls follow deployed states", () => {
  const s = {
    client,
    recipient,
    state: 1,
    rate: 1n,
    balance: 100n,
    withdrawn: 10n,
  } as Stream;
  assert.equal(permissions(s, recipient).pause, false);
  assert.equal(permissions(s, client).pause, true);
  assert.equal(permissions({ ...s, state: 2 }, client).deposit, true);
  assert.equal(permissions({ ...s, state: 2 }, client).refund, false);
  assert.equal(permissions({ ...s, rate: 0n }, client).restart, true);
  for (const state of [1, 2, 3, 4])
    assert.equal(permissions({ ...s, state }, recipient).withdraw, true);
  assert.equal(permissions({ ...s, state: 4 }, client).void, false);
  assert.equal(permissions(s, imd).dispute, false);
});
test("IMD stream allowance combines the bond and caller fee", () => {
  assert.deepEqual(disputeAllowances(imd, imd, 20n, 5n, 0n), [
    { token: imd, amount: 25n, kind: "bond and oracle fee" },
  ]);
  // The fund can be consumed by ordering, so the whole fee is approved even when the fund covers it.
  assert.equal(disputeAllowances(imd, imd, 20n, 5n, 5n)[0].amount, 25n);
  assert.deepEqual(
    disputeAllowances(client, imd, 20n, 5n, 0n).map((x) => x.amount),
    [20n, 5n],
  );
});
test("ABI bindings equal the attested hashes", async () => {
  const handoff = JSON.parse(
    await readFile(
      new URL("../deployment/handoff.json", import.meta.url),
      "utf8",
    ),
  );
  for (const c of handoff.contracts)
    assert.equal(
      hashAbi(
        JSON.parse(
          await readFile(
            new URL(`../../docs/abi/${c.name}.json`, import.meta.url),
            "utf8",
          ),
        ),
      ),
      c.abiHash,
    );
});
test("unknown chain offers exact add-chain parameters then retries switching", async () => {
  const network = JSON.parse(
    await readFile(
      new URL("../deployment/network.json", import.meta.url),
      "utf8",
    ),
  );
  let current = 1,
    known = false;
  const requests: { method: string; params?: unknown[] }[] = [];
  await switchProvider(
    {
      request: async (req) => {
        requests.push(req);
        if (req.method === "eth_chainId") return current;
        if (req.method === "wallet_switchEthereumChain") {
          if (!known) throw { code: 4902 };
          current = network.network.chainId;
        }
        if (req.method === "wallet_addEthereumChain") known = true;
      },
    },
    {
      chain: { id: network.network.chainId, name: network.network.name },
      deployment: network,
    } as Runtime,
  );
  assert.deepEqual(
    requests.find((r) => r.method === "wallet_addEthereumChain")?.params,
    [network.walletAddChain],
  );
  assert.equal(
    requests.filter((r) => r.method === "wallet_switchEthereumChain").length,
    2,
  );
});
test("a rejected switch never triggers add-chain", async () => {
  const calls: string[] = [];
  await assert.rejects(() =>
    switchProvider(
      {
        request: async (req) => {
          calls.push(req.method);
          if (req.method === "eth_chainId") return 1;
          throw { code: 4001 };
        },
      },
      { chain: { id: 4663 }, deployment: {} } as Runtime,
    ),
  );
  assert.equal(calls.includes("wallet_addEthereumChain"), false);
});
test("custom reverts and rejected signatures receive useful copy", () => {
  const abi = [{ type: "error", name: "HoldRequired", inputs: [] }] as const;
  const error = new ContractFunctionRevertedError({
    abi,
    data: encodeErrorResult({ abi, errorName: "HoldRequired" }),
    functionName: "createStream",
  });
  assert.match(errorText(error), /required WEIR balance/);
  assert.match(errorText({ code: 4001 }), /declined/);
});
test("describeDuration rounds to the unit people say", () => {
  assert.equal(describeDuration(30n), "under a minute");
  assert.equal(describeDuration(3460n), "about 58 minutes");
  assert.equal(describeDuration(5400n), "about 1.5 hours");
  assert.equal(describeDuration(7200n), "about 2 hours");
  assert.equal(describeDuration(86400n), "about 1 day");
  assert.equal(describeDuration(86505n), "about 1 day");
  assert.equal(describeDuration(3n * 86400n), "about 3 days");
  assert.equal(describeDuration(14n * 86400n), "about 2 weeks");
  assert.equal(describeDuration(100n * 86400n), "about 14 weeks");
});
