import type { ProposalInfo, ProposalRuntimeInfo } from "../../eth/governor";

type ProposalActionButtonsProps = {
  proposal: ProposalInfo;
  runtime?: ProposalRuntimeInfo;
  chainHead?: { blockNumber: bigint; blockTimestamp: bigint } | null;
  pendingAction?: "vote" | "queue" | "execute" | null;
  canAct: boolean;
  reviewLoading: boolean;
  hasBundle: boolean;
  reviewLabel?: string;
  onReview: (proposal: ProposalInfo) => void;
  onCastVote: (proposalId: bigint) => void;
  onQueue: (proposal: ProposalInfo) => void;
  onExecute: (proposal: ProposalInfo) => void;
};

function voteDirectionLabel(direction: ProposalRuntimeInfo["voteDirection"]): string {
  if (direction === "for") return "For";
  if (direction === "against") return "Against";
  if (direction === "abstain") return "Abstain";
  return "Unknown";
}

export function ProposalActionButtons(props: ProposalActionButtonsProps) {
  const runtime = props.runtime;
  const state = runtime?.state ?? props.proposal.state;
  const currentBlock = props.chainHead?.blockNumber ?? 0n;
  const currentTimestamp = props.chainHead?.blockTimestamp ?? 0n;

  const pendingAction = props.pendingAction ?? null;
  const governanceActionPending = pendingAction !== null;

  const voteButton = (() => {
    if (pendingAction === "vote") {
      return { label: "Voting...", disabled: true };
    }
    if (runtime?.hasVoted) {
      const direction = voteDirectionLabel(runtime.voteDirection);
      const weight = runtime.voteWeight?.toString() ?? "?";
      return { label: `Voted ${direction} (${weight})`, disabled: true };
    }
    if (state === "Pending") {
      const remaining = runtime ? (runtime.snapshotBlock > currentBlock ? runtime.snapshotBlock - currentBlock : 0n) : 0n;
      const label = remaining > 0n ? `Vote in ${remaining.toString()} blocks` : "Vote pending";
      return { label, disabled: true };
    }
    if (state === "Active") {
      return { label: "Vote", disabled: !props.canAct };
    }
    return { label: "Vote closed", disabled: true };
  })();

  const queueButton = (() => {
    if (pendingAction === "queue") {
      return { label: "Queueing...", disabled: true };
    }
    if (state === "Succeeded") {
      return { label: "Queue", disabled: !props.canAct };
    }
    if (state === "Pending" || state === "Active") {
      const remaining = runtime
        ? runtime.deadlineBlock >= currentBlock
          ? runtime.deadlineBlock - currentBlock + 1n
          : 0n
        : 0n;
      const label = remaining > 0n ? `Queue in ${remaining.toString()} blocks` : "Queue pending";
      return { label, disabled: true };
    }
    if (state === "Queued") return { label: "Queued", disabled: true };
    if (state === "Executed") return { label: "Queued", disabled: true };
    return { label: "Queue unavailable", disabled: true };
  })();

  const executeButton = (() => {
    if (pendingAction === "execute") {
      return { label: "Executing...", disabled: true };
    }
    if (state === "Queued") {
      const remaining = runtime
        ? runtime.etaSeconds > currentTimestamp
          ? runtime.etaSeconds - currentTimestamp
          : 0n
        : 0n;
      if (remaining > 0n) {
        return { label: `Execute in ${remaining.toString()}s`, disabled: true };
      }
      return { label: "Execute", disabled: !props.canAct };
    }
    if (state === "Executed") return { label: "Executed", disabled: true };
    if (state === "Succeeded") return { label: "Execute after queue", disabled: true };
    return { label: "Execute unavailable", disabled: true };
  })();

  return (
    <div className="studio-actions">
      <button
        className="btn"
        onClick={() => props.onReview(props.proposal)}
        disabled={!props.hasBundle || props.reviewLoading}
      >
        {props.reviewLabel ?? "Review"}
      </button>
      <button className="btn" onClick={() => props.onCastVote(props.proposal.proposalId)} disabled={voteButton.disabled}>
        {pendingAction === "vote" ? <span className="studio-spinner" aria-hidden="true" /> : null}
        {voteButton.label}
      </button>
      <button
        className="btn"
        onClick={() => props.onQueue(props.proposal)}
        disabled={queueButton.disabled || governanceActionPending}
      >
        {pendingAction === "queue" ? <span className="studio-spinner" aria-hidden="true" /> : null}
        {queueButton.label}
      </button>
      <button
        className="btn"
        onClick={() => props.onExecute(props.proposal)}
        disabled={executeButton.disabled || governanceActionPending}
      >
        {pendingAction === "execute" ? <span className="studio-spinner" aria-hidden="true" /> : null}
        {executeButton.label}
      </button>
    </div>
  );
}
