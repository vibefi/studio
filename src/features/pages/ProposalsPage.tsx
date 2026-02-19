import type { ProposalInfo, ProposalRuntimeInfo } from "../../eth/governor";
import type { DappRow } from "../../eth/registry";
import { shortHash } from "../../env";
import { SectionCard } from "../../components/StudioUi";
import { ProposalActionButtons } from "../components/ProposalActionButtons";
import {
  formatProposalIdCompact,
  proposalStateClass,
  type ProposalWithBundle,
} from "../studio-model";

type ProposalFilter = "all" | "active" | "historical";
type VoteSupport = "for" | "against" | "abstain";

type ProposalsPageProps = {
  proposalView: ProposalFilter;
  voteSupport: VoteSupport;
  voteReason: string;
  proposalRows: ProposalWithBundle[];
  proposalRuntimeById: Record<string, ProposalRuntimeInfo>;
  chainHead: { blockNumber: bigint; blockTimestamp: bigint } | null;
  pendingGovernanceActionByProposalId: Record<string, "vote" | "queue" | "execute" | null>;
  dapps: DappRow[];
  canAct: boolean;
  reviewLoading: boolean;
  onProposalViewChange: (value: ProposalFilter) => void;
  onVoteSupportChange: (value: VoteSupport) => void;
  onVoteReasonChange: (value: string) => void;
  onReviewProposalBundle: (proposal: ProposalInfo) => void;
  onCastVote: (proposalId: bigint) => void;
  onQueue: (proposal: ProposalInfo) => void;
  onExecute: (proposal: ProposalInfo) => void;
};

export function ProposalsPage(props: ProposalsPageProps) {
  return (
    <>
      <SectionCard
        title="Proposals"
        subtitle="Loaded from deploy block onward, including historical and executed proposals"
        right={
          <div className="studio-inline-controls">
            <select
              value={props.proposalView}
              onChange={(e) => props.onProposalViewChange(e.target.value as ProposalFilter)}
            >
              <option value="all">view: all</option>
              <option value="active">view: active/open</option>
              <option value="historical">view: historical/executed</option>
            </select>
            <select
              value={props.voteSupport}
              onChange={(e) => props.onVoteSupportChange(e.target.value as VoteSupport)}
            >
              <option value="for">vote: for</option>
              <option value="against">vote: against</option>
              <option value="abstain">vote: abstain</option>
            </select>
            <input
              value={props.voteReason}
              onChange={(e) => props.onVoteReasonChange(e.target.value)}
              placeholder="vote reason (optional)"
            />
          </div>
        }
      >
        <div className="studio-table-wrap">
          <table className="studio-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>State</th>
                <th>Proposer</th>
                <th>Bundle CID</th>
                <th>Description</th>
                <th className="studio-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.proposalRows.map(({ proposal, bundleRef }) => {
                const runtime = props.proposalRuntimeById[proposal.proposalId.toString()];
                const effectiveState = runtime?.state ?? proposal.state;
                return (
                  <tr key={proposal.proposalId.toString()}>
                    <td title={`#${proposal.proposalId.toString()}`}>{formatProposalIdCompact(proposal.proposalId)}</td>
                    <td>
                      <span className={`state-chip ${proposalStateClass(effectiveState)}`}>{effectiveState}</span>
                    </td>
                    <td>{shortHash(proposal.proposer)}</td>
                    <td>{bundleRef?.rootCid ? <code>{shortHash(bundleRef.rootCid)}</code> : "-"}</td>
                    <td>{proposal.description}</td>
                    <td className="studio-col-actions">
                      <ProposalActionButtons
                        proposal={proposal}
                        runtime={runtime}
                        chainHead={props.chainHead}
                        pendingAction={props.pendingGovernanceActionByProposalId[proposal.proposalId.toString()] ?? null}
                        canAct={props.canAct}
                        reviewLoading={props.reviewLoading}
                        hasBundle={!!bundleRef?.rootCid}
                        reviewLabel="Review Bundle"
                        onReview={props.onReviewProposalBundle}
                        onCastVote={props.onCastVote}
                        onQueue={props.onQueue}
                        onExecute={props.onExecute}
                      />
                    </td>
                  </tr>
                );
              })}
              {props.proposalRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="studio-empty-cell">
                    No proposals found for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Registry Verification" subtitle="Dapp registry state from governance updates">
        <div className="studio-table-wrap">
          <table className="studio-table">
            <thead>
              <tr>
                <th>Dapp</th>
                <th>Version ID</th>
                <th>Name/Version</th>
                <th>Status</th>
                <th>Root CID</th>
              </tr>
            </thead>
            <tbody>
              {props.dapps.map((item) => (
                <tr key={`${item.dappId.toString()}-${item.versionId.toString()}`}>
                  <td>#{item.dappId.toString()}</td>
                  <td>{item.versionId.toString()}</td>
                  <td>
                    {item.name} ({item.version})
                  </td>
                  <td>{item.status}</td>
                  <td>{item.rootCid || "-"}</td>
                </tr>
              ))}
              {props.dapps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="studio-empty-cell">
                    No dapp registry entries found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
