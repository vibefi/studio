import type { ProposalInfo } from "../../eth/governor";

type ProposalActionButtonsProps = {
  proposal: ProposalInfo;
  canAct: boolean;
  reviewLoading: boolean;
  hasBundle: boolean;
  reviewLabel?: string;
  onReview: (proposal: ProposalInfo) => void;
  onCastVote: (proposalId: bigint) => void;
  onQueue: (proposal: ProposalInfo) => void;
  onExecute: (proposal: ProposalInfo) => void;
};

export function ProposalActionButtons(props: ProposalActionButtonsProps) {
  return (
    <div className="studio-actions">
      <button
        className="btn"
        onClick={() => props.onReview(props.proposal)}
        disabled={!props.hasBundle || props.reviewLoading}
      >
        {props.reviewLabel ?? "Review"}
      </button>
      <button className="btn" onClick={() => props.onCastVote(props.proposal.proposalId)} disabled={!props.canAct}>
        Vote
      </button>
      <button
        className="btn"
        onClick={() => props.onQueue(props.proposal)}
        disabled={!props.canAct || props.proposal.state !== "Succeeded"}
      >
        Queue
      </button>
      <button
        className="btn"
        onClick={() => props.onExecute(props.proposal)}
        disabled={!props.canAct || props.proposal.state !== "Queued"}
      >
        Execute
      </button>
    </div>
  );
}
