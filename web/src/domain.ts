import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

export const UINT128_MAX = (1n << 128n) - 1n;
export const UINT256_MAX = (1n << 256n) - 1n;
export const byteLength = (s: string) => new TextEncoder().encode(s).length;
export function amount(
  value: string,
  decimals: number,
  max = UINT256_MAX,
): bigint {
  value = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error(
      "Enter a positive amount using digits and a decimal point.",
    );
  if ((value.split(".")[1]?.length ?? 0) > decimals)
    throw new Error(`Use at most ${decimals} decimal places for this token.`);
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n) throw new Error("Enter an amount greater than zero.");
  if (parsed > max) throw new Error("This amount exceeds the contract limit.");
  return parsed;
}
export function tryAmount(
  value: string,
  decimals: number,
  max = UINT256_MAX,
): bigint | undefined {
  try {
    return amount(value, decimals, max);
  } catch {
    return undefined;
  }
}
export function address(value: string): Address {
  const v = value.trim();
  if (!isAddress(v) || v.toLowerCase() === zeroAddress)
    throw new Error("Enter a valid, nonzero Ethereum address.");
  return getAddress(v);
}
export function jobId(value: string): Hex {
  if (!value.trim()) return zeroHash;
  if (/^0x[0-9a-fA-F]{64}$/.test(value.trim())) return value.trim() as Hex;
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value.trim(),
    )
  )
    return `0x${value.trim().replaceAll("-", "")}${"0".repeat(32)}` as Hex;
  throw new Error("Use an IMD job UUID or a 32-byte hex ID.");
}
export function displayJob(id: Hex): string {
  if (id.endsWith("0".repeat(32))) {
    const s = id.slice(2, 34);
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return id;
}
export function safeUri(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (["https:", "http:", "ipfs:"].includes(url.protocol)) return url.href;
  } catch {
    /* display as plain text */
  }
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Human amount: thousands separators, at most 6 decimals (trailing zeros trimmed). `exact()` keeps every digit. */
export function units(value: bigint, decimals: number, maxFraction = 6) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, "");
  const tiny = value > 0n && whole === "0" && trimmed === "" ? "<0.000001" : null;
  return tiny ?? `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${trimmed ? `.${trimmed}` : ""}`;
}
export const exact = (value: bigint, decimals: number) => units(value, decimals, 255);
export type Stream = {
  client: Address;
  recipient: Address;
  token: Address;
  rate: bigint;
  pausedRate: bigint;
  balance: bigint;
  withdrawn: bigint;
  snapDebt: bigint;
  snapTime: bigint;
  state: number;
  termsHash: Hex;
  termsURI: string;
  imdJobId: Hex;
  requestId: Hex;
  disputedAt: bigint;
  disputer: Address;
  bond: bigint;
  ruling: number;
};
export const stateLabel = (s: Stream) =>
  s.state === 1
    ? s.rate === 0n
      ? "Paused"
      : "Active"
    : (["Unknown", "", "Disputed", "Ruled", "Closed"][s.state] ?? "Unknown");
export function permissions(s: Stream, account?: Address) {
  const client = account?.toLowerCase() === s.client.toLowerCase(),
    recipient = account?.toLowerCase() === s.recipient.toLowerCase();
  return {
    client,
    recipient,
    deposit: client && [1, 2].includes(s.state),
    pause: client && s.state === 1 && s.rate > 0n,
    restart: client && s.state === 1 && s.rate === 0n,
    adjust: client && s.state === 1 && s.rate > 0n,
    refund: client && s.state === 1,
    void: client && s.state === 1,
    withdraw: recipient && s.state > 0,
    dispute: (client || recipient) && s.state === 1 && s.balance > s.withdrawn,
    enforce: s.state === 3,
    expire: s.state === 2,
  };
}
export function disputeAllowances(
  token: Address,
  imd: Address,
  bond: bigint,
  price: bigint,
  fund: bigint,
) {
  // The contract pulls 20% of the fee from the disputer and the rest too when the court fund cannot cover it
  // (or has already subsidised five disputes today), so the worst case is approved: only what is needed is used.
  void fund;
  const fee = price;
  return token.toLowerCase() === imd.toLowerCase()
    ? [{ token, amount: bond + fee, kind: "bond and oracle fee" }]
    : [
        { token, amount: bond, kind: "bond" },
        { token: imd, amount: fee, kind: "oracle fee" },
      ];
}
const errors: Record<string, string> = {
  HoldRequired:
    "Hold the required WEIR balance to create a stream or raise a dispute.",
  NotClient: "Only this stream’s client can do that.",
  NotRecipient: "Only this stream’s recipient can do that.",
  NotParty: "Only the client or recipient can raise this dispute.",
  UnknownStream: "This stream ID does not exist. Check the ID and try again.",
  WrongState:
    "The stream has changed. Refresh it and choose an available action.",
  AlreadyPaused: "The stream is already paused.",
  NotPaused: "Pause the stream before restarting it.",
  DisputeNotExpired: "The dispute timeout has not passed yet.",
  AmountExceedsAvailable:
    "The amount exceeds what is currently available. Refresh and choose a smaller amount or use Max.",
  BondExceedsLimit:
    "The bond increased since your preview. Refresh the dispute quote before continuing.",
  NoStake: "There are no funds left in this stream to dispute.",
  ZeroAmount: "Enter an amount greater than zero.",
  ZeroRate: "Enter a positive rate per second.",
  ZeroTermsHash: "Add a nonzero terms hash.",
  InvalidRecipient:
    "Use a recipient other than your wallet or the Weir contract.",
  ZeroAddress: "Enter a valid nonzero address.",
  TextTooLong: "Shorten the text to fit the displayed byte limit.",
  InvalidUTF8: "Use valid UTF-8 text without control characters.",
  AlreadyAccepted: "These terms have already been accepted.",
  NothingToClaim: "There is no deferred payout to claim for this token.",
  OraclePriceOutOfRange:
    "The oracle is unavailable at an allowed price. Try again later.",
  TransferMismatch:
    "This token does not transfer exact amounts. Use an exact-transfer, non-rebasing token.",
  Insolvent:
    "This token cannot currently meet its obligations. The transaction was stopped.",
  SafeERC20FailedOperation:
    "The token refused the transfer. Check its balance, allowance and transfer restrictions.",
  ERC20InsufficientAllowance:
    "The allowance is too small. Refresh and approve the required amount.",
  ERC20InsufficientBalance: "Your token balance is too small for this action.",
  ReentrancyGuardReentrantCall:
    "The token attempted an unsupported nested operation. The transaction was stopped.",
};
export function errorText(error: unknown): string {
  const e = error as {
    code?: number;
    shortMessage?: string;
    message?: string;
    cause?: unknown;
    data?: { errorName?: string };
  };
  if (e?.code === 4001 || /user rejected|user denied/i.test(e?.message ?? ""))
    return "Request declined in your wallet. You can try again.";
  const revert =
    error instanceof BaseError
      ? (error.walk(
          (x) => x instanceof ContractFunctionRevertedError,
        ) as ContractFunctionRevertedError)
      : undefined;
  const name = revert?.data?.errorName ?? e?.data?.errorName;
  if (name === "CooldownActive") {
    const until = (revert?.data?.args as readonly unknown[] | undefined)?.[0];
    return typeof until === "bigint"
      ? `You already raised a dispute on this stream. You can raise another on ${new Date(Number(until) * 1000).toLocaleString()}.`
      : "You already raised a dispute on this stream recently. Wait a few days before raising another.";
  }
  if (name)
    return (
      errors[name] ??
      `The contract stopped this action (${name}). Refresh the state before trying again.`
    );
  if (/insufficient funds/i.test(e?.message ?? ""))
    return "Your wallet needs more ETH for the network fee.";
  if (/fetch|network|HTTP|RPC|timeout/i.test(e?.message ?? ""))
    return "The network did not respond. Try refreshing or check your connection.";
  return (
    e?.shortMessage?.slice(0, 220) ??
    e?.message?.slice(0, 220) ??
    "The action could not finish. Refresh and try again."
  );
}

/** Rounds a span of seconds to the unit people say out loud: "about 58 minutes", "about 1 day". */
export function describeDuration(seconds: bigint): string {
  const s = Number(seconds);
  if (s < 60) return "under a minute";
  const steps: [number, string][] = [
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of steps) {
    if (s >= size) {
      const n = Math.round((s / size) * 10) / 10;
      const shown = n >= 10 ? Math.round(n) : n;
      return `about ${shown} ${name}${shown === 1 ? "" : "s"}`;
    }
  }
  return "under a minute";
}
