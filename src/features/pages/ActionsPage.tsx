import type { ProposalInfo } from "../../eth/governor";
import { Field, SectionCard } from "../../components/StudioUi";
import type { ProposalWithBundle } from "../studio-model";
import { proposalStateClass } from "../studio-model";
import { ProposalActionButtons } from "../components/ProposalActionButtons";

type PublishFormState = {
  rootCid: string;
  name: string;
  version: string;
  description: string;
  proposalDescription: string;
};

type UpgradeFormState = {
  dappId: string;
  rootCid: string;
  name: string;
  version: string;
  description: string;
  proposalDescription: string;
};

type ActionsPageProps = {
  publishForm: PublishFormState;
  upgradeForm: UpgradeFormState;
  canAct: boolean;
  reviewLoading: boolean;
  queuedActions: ProposalWithBundle[];
  onPublishChange: (field: keyof PublishFormState, value: string) => void;
  onUpgradeChange: (field: keyof UpgradeFormState, value: string) => void;
  onProposePublish: () => void;
  onProposeUpgrade: () => void;
  onReviewProposalBundle: (proposal: ProposalInfo) => void;
  onCastVote: (proposalId: bigint) => void;
  onQueue: (proposal: ProposalInfo) => void;
  onExecute: (proposal: ProposalInfo) => void;
};

export function ActionsPage(props: ActionsPageProps) {
  return (
    <>
      <section className="studio-grid-two">
        <SectionCard title="Propose Publish" subtitle="Create governance proposal for publishDapp">
          <div className="studio-form-grid">
            <Field label="Root CID">
              <input
                value={props.publishForm.rootCid}
                onChange={(e) => props.onPublishChange("rootCid", e.target.value)}
                placeholder="bafy..."
              />
            </Field>
            <Field label="Name">
              <input
                value={props.publishForm.name}
                onChange={(e) => props.onPublishChange("name", e.target.value)}
                placeholder="VibeFi Studio"
              />
            </Field>
            <Field label="Version">
              <input
                value={props.publishForm.version}
                onChange={(e) => props.onPublishChange("version", e.target.value)}
                placeholder="0.0.1"
              />
            </Field>
            <Field label="Description">
              <input
                value={props.publishForm.description}
                onChange={(e) => props.onPublishChange("description", e.target.value)}
                placeholder="Main governance frontend"
              />
            </Field>
            <Field label="Proposal Description">
              <input
                value={props.publishForm.proposalDescription}
                onChange={(e) => props.onPublishChange("proposalDescription", e.target.value)}
                placeholder="optional"
              />
            </Field>
            <button className="btn btn-primary" onClick={props.onProposePublish} disabled={!props.canAct}>
              Submit Publish Proposal
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Propose Upgrade" subtitle="Create governance proposal for upgradeDapp">
          <div className="studio-form-grid">
            <Field label="Dapp ID" hint="Unsigned integer">
              <input
                value={props.upgradeForm.dappId}
                onChange={(e) => props.onUpgradeChange("dappId", e.target.value)}
                placeholder="1"
              />
            </Field>
            <Field label="New Root CID">
              <input
                value={props.upgradeForm.rootCid}
                onChange={(e) => props.onUpgradeChange("rootCid", e.target.value)}
                placeholder="bafy..."
              />
            </Field>
            <Field label="Name">
              <input
                value={props.upgradeForm.name}
                onChange={(e) => props.onUpgradeChange("name", e.target.value)}
                placeholder="VibeFi Studio"
              />
            </Field>
            <Field label="Version">
              <input
                value={props.upgradeForm.version}
                onChange={(e) => props.onUpgradeChange("version", e.target.value)}
                placeholder="0.0.2"
              />
            </Field>
            <Field label="Description">
              <input
                value={props.upgradeForm.description}
                onChange={(e) => props.onUpgradeChange("description", e.target.value)}
                placeholder="Updated governance frontend"
              />
            </Field>
            <Field label="Proposal Description">
              <input
                value={props.upgradeForm.proposalDescription}
                onChange={(e) => props.onUpgradeChange("proposalDescription", e.target.value)}
                placeholder="optional"
              />
            </Field>
            <button className="btn btn-primary" onClick={props.onProposeUpgrade} disabled={!props.canAct}>
              Submit Upgrade Proposal
            </button>
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Governance Action Queue" subtitle="Vote, queue, and execute from one focused list">
        <div className="studio-table-wrap">
          <table className="studio-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>State</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.queuedActions.map(({ proposal, bundleRef }) => (
                <tr key={`action-${proposal.proposalId.toString()}`}>
                  <td>#{proposal.proposalId.toString()}</td>
                  <td>
                    <span className={`state-chip ${proposalStateClass(proposal.state)}`}>{proposal.state}</span>
                  </td>
                  <td>{proposal.description}</td>
                  <td>
                    <ProposalActionButtons
                      proposal={proposal}
                      canAct={props.canAct}
                      reviewLoading={props.reviewLoading}
                      hasBundle={!!bundleRef?.rootCid}
                      onReview={props.onReviewProposalBundle}
                      onCastVote={props.onCastVote}
                      onQueue={props.onQueue}
                      onExecute={props.onExecute}
                    />
                  </td>
                </tr>
              ))}
              {props.queuedActions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="studio-empty-cell">
                    No actionable proposals for this wallet/network.
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
