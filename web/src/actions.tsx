import { useEffect, useState } from "react";
import type { Address, TransactionReceipt } from "viem";
import { useAccount } from "wagmi";
import {
  useAllowance,
  useBalance,
  useReady,
  useRuntime,
  useTransaction,
  type Token,
} from "./data";
import { units } from "./domain";
import { Dialog, Notice, QueryState, TxButton, TxFeedback } from "./ui";

export function ApprovalAction({
  token,
  amount,
  name,
  args,
  label,
  disabled = false,
  onDone,
  onBusy,
  preflight,
  after = [],
}: {
  token: Token;
  amount: bigint;
  name: string;
  args: readonly unknown[];
  label: string;
  disabled?: boolean;
  onDone?: (receipt: TransactionReceipt) => void;
  onBusy?: (busy: boolean) => void;
  preflight?: () => Promise<void>;
  /** Wallet steps that follow this action, shown in the step list so nobody leaves early. */
  after?: string[];
}) {
  const r = useRuntime();
  const gate = useReady();
  const { address } = useAccount();
  const allowance = useAllowance(token.address, address);
  const balance = useBalance(token.address, address);
  const approve = useTransaction();
  const action = useTransaction();
  const pending = approve.pending || action.pending;
  useEffect(() => {
    onBusy?.(pending);
  }, [pending, onBusy]);
  const loaded =
    allowance.data !== undefined &&
    balance.data !== undefined &&
    !allowance.isError &&
    !balance.isError;
  const enough = loaded && balance.data! >= amount;
  const approved = loaded && allowance.data! >= amount;
  const needsReset = !approved && (allowance.data ?? 0n) > 0n;
  return (
    <div className="approval-flow">
      <ol className="steps" aria-label={`${label} steps`}>
        <li className={approved ? "done" : "current"}>
          {approved ? "✓" : "1"} Approve {token.symbol}
        </li>
        <li className={approved ? "current" : ""}>2 {label}</li>
        {after.map((step, i) => (
          <li key={step}>
            {i + 3} {step}
          </li>
        ))}
      </ol>
      <p className="muted">
        Allow Weir to spend {units(amount, token.decimals)} {token.symbol}.
        Network fees are paid in ETH.
      </p>
      {!gate.ready && <Notice>{gate.reason}</Notice>}
      {gate.address && (
        <>
          <QueryState query={allowance} />
          <QueryState query={balance} />
        </>
      )}
      {loaded && !enough && (
        <Notice error>
          You need {units(amount, token.decimals)} {token.symbol}; your balance
          is {units(balance.data!, token.decimals)} {token.symbol}.
        </Notice>
      )}
      {!approved ? (
        <>
          <TxButton
            label={
              needsReset
                ? `Reset ${token.symbol} allowance`
                : `Approve ${token.symbol}`
            }
            pending={approve.pending}
            phase={approve.state.phase}
            disabled={
              !gate.ready ||
              !loaded ||
              !enough ||
              disabled ||
              action.pending ||
              amount <= 0n
            }
            onClick={() =>
              approve.run(
                "approve",
                [r.weir.address, needsReset ? 0n : amount],
                token.address,
              )
            }
            primary
          />
          {needsReset && (
            <small className="muted">
              Clear the existing allowance first, then approve the exact amount.
            </small>
          )}
        </>
      ) : (
        <TxButton
          label={label}
          pending={action.pending}
          phase={action.state.phase}
          disabled={
            !gate.ready ||
            !enough ||
            disabled ||
            approve.pending ||
            amount <= 0n
          }
          primary
          onClick={async () => {
            const receipt = await action.run(name, args, undefined, preflight);
            if (receipt) onDone?.(receipt);
          }}
        />
      )}
      <TxFeedback state={approve.state} />
      <TxFeedback state={action.state} />
    </div>
  );
}
export function Action({
  name,
  args,
  label,
  disabled = false,
  confirm,
  danger = false,
  onDone,
}: {
  name: string;
  args: readonly unknown[];
  label: string;
  disabled?: boolean;
  confirm?: string;
  danger?: boolean;
  onDone?: () => void;
}) {
  const tx = useTransaction();
  const gate = useReady();
  const [open, setOpen] = useState(false);
  const send = async () => {
    const receipt = await tx.run(name, args);
    if (receipt) {
      setOpen(false);
      onDone?.();
    }
  };
  return (
    <div className="action">
      <TxButton
        label={label}
        pending={tx.pending}
        phase={tx.state.phase}
        disabled={!gate.ready || disabled}
        danger={danger}
        onClick={() => (confirm ? setOpen(true) : send())}
      />
      {!open && <TxFeedback state={tx.state} />}{" "}
      {open && (
        <Dialog
          title={`${label}?`}
          onClose={() => {
            if (!tx.pending) setOpen(false);
          }}
        >
          <p>{confirm}</p>
          <TxButton
            label={label}
            pending={tx.pending}
            phase={tx.state.phase}
            disabled={!gate.ready || disabled}
            danger={danger}
            onClick={send}
          />
          <TxFeedback state={tx.state} />
        </Dialog>
      )}
    </div>
  );
}
export function Claim({ token }: { token: Token }) {
  return (
    <Action
      name="claim"
      args={[token.address]}
      label={`Claim ${token.symbol} payout`}
    />
  );
}
