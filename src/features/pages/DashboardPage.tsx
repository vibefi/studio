import { SectionCard } from "../../components/StudioUi";
import type { DappRow } from "../../eth/registry";
import type { ProposalInfo, ProposalRuntimeInfo } from "../../eth/governor";
import type { ProposalWithBundle } from "../studio-model";
import { proposalStateClass } from "../studio-model";
import { ProposalActionButtons } from "../components/ProposalActionButtons";

type DashboardPageProps = {
  proposalsCount: number;
  activeCount: number;
  readyToQueueCount: number;
  queuedCount: number;
  executedCount: number;
  dappsCount: number;
  queuedActions: ProposalWithBundle[];
  proposalRuntimeById: Record<string, ProposalRuntimeInfo>;
  chainHead: { blockNumber: bigint; blockTimestamp: bigint } | null;
  pendingGovernanceActionByProposalId: Record<string, "vote" | "queue" | "execute" | null>;
  recentDapps: DappRow[];
  canAct: boolean;
  reviewLoading: boolean;
  onReviewProposalBundle: (proposal: ProposalInfo) => void;
  onCastVote: (proposalId: bigint) => void;
  onQueue: (proposal: ProposalInfo) => void;
  onExecute: (proposal: ProposalInfo) => void;
};

export function DashboardPage(props: DashboardPageProps) {
  return (
    <>
      <section className="studio-metrics">
        <article className="studio-metric-card">
          <span>Proposals</span>
          <strong>{props.proposalsCount}</strong>
        </article>
        <article className="studio-metric-card">
          <span>Active</span>
          <strong>{props.activeCount}</strong>
        </article>
        <article className="studio-metric-card">
          <span>Ready To Queue</span>
          <strong>{props.readyToQueueCount}</strong>
        </article>
        <article className="studio-metric-card">
          <span>Queued</span>
          <strong>{props.queuedCount}</strong>
        </article>
        <article className="studio-metric-card">
          <span>Executed</span>
          <strong>{props.executedCount}</strong>
        </article>
        <article className="studio-metric-card">
          <span>Registry Entries</span>
          <strong>{props.dappsCount}</strong>
        </article>
      </section>

      <SectionCard title="Priority Queue" subtitle="Top proposals that need governance actions">
        <div className="studio-list">
          {props.queuedActions.slice(0, 8).map(({ proposal, bundleRef }) => (
            (() => {
              const runtime = props.proposalRuntimeById[proposal.proposalId.toString()];
              const state = runtime?.state ?? proposal.state;
              return (
                <div className="studio-list-item" key={`dashboard-${proposal.proposalId.toString()}`}>
                  <div>
                    <strong>#{proposal.proposalId.toString()}</strong>{" "}
                    <span className={`state-chip ${proposalStateClass(state)}`}>{state}</span>
                    <p>{proposal.description}</p>
                  </div>
                  <ProposalActionButtons
                    proposal={proposal}
                    runtime={runtime}
                    chainHead={props.chainHead}
                    pendingAction={props.pendingGovernanceActionByProposalId[proposal.proposalId.toString()] ?? null}
                    canAct={props.canAct}
                    reviewLoading={props.reviewLoading}
                    hasBundle={!!bundleRef?.rootCid}
                    onReview={props.onReviewProposalBundle}
                    onCastVote={props.onCastVote}
                    onQueue={props.onQueue}
                    onExecute={props.onExecute}
                  />
                </div>
              );
            })()
          ))}
          {props.queuedActions.length === 0 ? (
            <div className="studio-empty-cell">No actionable proposals right now.</div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Registry Pulse" subtitle="Recent registry versions">
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
              {props.recentDapps.map((item) => (
                <tr key={`dashboard-${item.dappId.toString()}-${item.versionId.toString()}`}>
                  <td>#{item.dappId.toString()}</td>
                  <td>{item.versionId.toString()}</td>
                  <td>
                    {item.name} ({item.version})
                  </td>
                  <td>{item.status}</td>
                  <td>{item.rootCid || "-"}</td>
                </tr>
              ))}
              {props.recentDapps.length === 0 ? (
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
