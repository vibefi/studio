import { type ReactNode, useMemo, useState } from "react";
import { type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import addressesJson from "../addresses.json";
import { shortHash } from "./env";
import { buildPublicClient, buildWalletClient, connectWallet } from "./eth/clients";
import {
  type ProposalInfo,
  castVote,
  executeProposal,
  listProposals,
  queueProposal,
} from "./eth/governor";
import { listDapps, proposePublish, proposeUpgrade, type DappRow } from "./eth/registry";
import { ipfsReadSnippet } from "./ipfs/client";

type NetworkAddresses = {
  name?: string;
  deployBlock?: number;
  vfiGovernor: Address;
  dappRegistry: Address;
  vfiToken?: Address;
};

type AddressesMap = Record<string, NetworkAddresses>;

const ADDRESSES = addressesJson as AddressesMap;

function getNetwork(chainId: number | null): NetworkAddresses | null {
  if (!chainId) return null;
  return ADDRESSES[String(chainId)] ?? null;
}

function txUrl(chainId: number | null, hash: string) {
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
  return "";
}

function blockFrom(network: NetworkAddresses | null): bigint {
  return BigInt(network?.deployBlock ?? 0);
}

function parseDappId(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("dapp id is required");
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("dapp id must be an unsigned integer");
  }
  return BigInt(trimmed);
}

function SectionCard(props: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="studio-card">
      <div className="studio-card-head">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </div>
        {props.right ? <div>{props.right}</div> : null}
      </div>
      <div className="studio-card-body">{props.children}</div>
    </section>
  );
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="studio-field">
      <div className="studio-field-label">{props.label}</div>
      {props.children}
      {props.hint ? <div className="studio-field-hint">{props.hint}</div> : null}
    </label>
  );
}

function kv(label: string, value: ReactNode) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function proposalStateClass(state: string): string {
  if (state === "Succeeded" || state === "Executed") return "state-good";
  if (state === "Queued" || state === "Active" || state === "Pending") return "state-live";
  if (state === "Defeated" || state === "Canceled" || state === "Expired") return "state-bad";
  return "state-neutral";
}

export function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [publicClient, setPublicClient] = useState<PublicClient | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  const [status, setStatus] = useState<string>("Connect wallet to begin");
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [dapps, setDapps] = useState<DappRow[]>([]);

  const [publishRootCid, setPublishRootCid] = useState("");
  const [publishName, setPublishName] = useState("");
  const [publishVersion, setPublishVersion] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishProposalDescription, setPublishProposalDescription] = useState("");

  const [upgradeDappId, setUpgradeDappId] = useState("");
  const [upgradeRootCid, setUpgradeRootCid] = useState("");
  const [upgradeName, setUpgradeName] = useState("");
  const [upgradeVersion, setUpgradeVersion] = useState("");
  const [upgradeDescription, setUpgradeDescription] = useState("");
  const [upgradeProposalDescription, setUpgradeProposalDescription] = useState("");

  const [voteSupport, setVoteSupport] = useState<"for" | "against" | "abstain">("for");
  const [voteReason, setVoteReason] = useState("");

  const [reviewCid, setReviewCid] = useState("");
  const [reviewPath, setReviewPath] = useState("src/App.tsx");
  const [snippet, setSnippet] = useState<string>("");

  const network = useMemo(() => getNetwork(chainId), [chainId]);

  async function withClients() {
    if (!publicClient || !walletClient || !account || !network) {
      throw new Error("Wallet/network not ready");
    }
    return { publicClient, walletClient, account, network };
  }

  async function onConnect() {
    try {
      setStatus("Connecting wallet...");
      const connected = await connectWallet();
      const pub = buildPublicClient(connected.chainId);
      const wallet = await buildWalletClient(connected.chainId);
      setAccount(connected.account);
      setChainId(connected.chainId);
      setPublicClient(pub);
      setWalletClient(wallet);
      setStatus(`Connected ${connected.account} on chain ${connected.chainId}`);
      setTxHash(null);
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function refreshGovernanceData() {
    try {
      const clients = await withClients();
      setStatus("Refreshing proposals and registry data...");
      const fromBlock = blockFrom(clients.network);
      const [nextProposals, nextDapps] = await Promise.all([
        listProposals(clients.publicClient, clients.network.vfiGovernor, fromBlock),
        listDapps(clients.publicClient, clients.network.dappRegistry, fromBlock),
      ]);
      setProposals(nextProposals);
      setDapps(nextDapps);
      setStatus(`Loaded ${nextProposals.length} proposals and ${nextDapps.length} dapps`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function onProposePublish() {
    try {
      const clients = await withClients();
      setStatus("Submitting publish proposal...");
      const hash = await proposePublish(
        clients.walletClient,
        clients.network.vfiGovernor,
        clients.network.dappRegistry,
        clients.account,
        {
          rootCid: publishRootCid,
          name: publishName,
          dappVersion: publishVersion,
          description: publishDescription,
          proposalDescription: publishProposalDescription,
        }
      );
      setTxHash(hash);
      setStatus("Publish proposal submitted");
      await refreshGovernanceData();
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function onProposeUpgrade() {
    try {
      const clients = await withClients();
      setStatus("Submitting upgrade proposal...");
      const hash = await proposeUpgrade(
        clients.walletClient,
        clients.network.vfiGovernor,
        clients.network.dappRegistry,
        clients.account,
        {
          dappId: parseDappId(upgradeDappId),
          rootCid: upgradeRootCid,
          name: upgradeName,
          dappVersion: upgradeVersion,
          description: upgradeDescription,
          proposalDescription: upgradeProposalDescription,
        }
      );
      setTxHash(hash);
      setStatus("Upgrade proposal submitted");
      await refreshGovernanceData();
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function onCastVote(proposalId: bigint) {
    try {
      const clients = await withClients();
      setStatus(`Casting ${voteSupport} vote...`);
      const hash = await castVote(
        clients.walletClient,
        clients.network.vfiGovernor,
        clients.account,
        proposalId,
        voteSupport,
        voteReason
      );
      setTxHash(hash);
      setStatus("Vote submitted");
      await refreshGovernanceData();
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function onQueue(proposal: ProposalInfo) {
    try {
      const clients = await withClients();
      setStatus(`Queueing proposal #${proposal.proposalId.toString()}...`);
      const hash = await queueProposal(clients.walletClient, clients.network.vfiGovernor, clients.account, proposal);
      setTxHash(hash);
      setStatus("Queue submitted");
      await refreshGovernanceData();
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function onExecute(proposal: ProposalInfo) {
    try {
      const clients = await withClients();
      setStatus(`Executing proposal #${proposal.proposalId.toString()}...`);
      const hash = await executeProposal(clients.walletClient, clients.network.vfiGovernor, clients.account, proposal);
      setTxHash(hash);
      setStatus("Execute submitted");
      await refreshGovernanceData();
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  async function onLoadSnippet() {
    try {
      setStatus("Loading snippet from injected vibefiIpfs...");
      const result = (await ipfsReadSnippet(reviewCid, reviewPath, 1, 220)) as { text?: string };
      setSnippet(result.text ?? "");
      setStatus("Snippet loaded");
    } catch (err) {
      setStatus((err as Error).message);
      setSnippet("");
    }
  }

  const canAct = !!(publicClient && walletClient && account && network);
  const latestTxUrl = txHash ? txUrl(chainId, txHash) : "";

  return (
    <div className="studio-shell">
      <div className="studio-atmosphere" aria-hidden="true" />
      <main className="studio-page">
        <header className="studio-hero">
          <div>
            <div className="studio-eyebrow">VibeFi DAO Console</div>
            <h1>Studio</h1>
            <p>
              Governance entrypoint for publish/upgrade proposals, voting, queue/execute operations, registry
              verification, and safe IPFS snippet review.
            </p>
          </div>
          <div className="studio-hero-actions">
            <button className="btn btn-primary" onClick={onConnect}>
              Connect Wallet
            </button>
            <button className="btn" onClick={refreshGovernanceData} disabled={!canAct}>
              Refresh Data
            </button>
          </div>
          <div className="studio-status" role="status">
            <span className="pill">{canAct ? "ready" : "disconnected"}</span>
            <span>{status}</span>
          </div>
        </header>

        <section className="studio-grid-two">
          <SectionCard title="Connection" subtitle="Active network and contract context">
            <dl className="studio-kv">
              {kv("Account", account ? shortHash(account) : "not connected")}
              {kv("Chain", chainId ?? "unknown")}
              {kv("Network", network?.name ?? "unsupported")}
              {kv("Deploy block", network?.deployBlock ?? "n/a")}
              {kv("Governor", network?.vfiGovernor ?? "n/a")}
              {kv("Registry", network?.dappRegistry ?? "n/a")}
              {txHash
                ? kv(
                    "Last tx",
                    latestTxUrl ? (
                      <a href={latestTxUrl} target="_blank" rel="noreferrer">
                        {shortHash(txHash)}
                      </a>
                    ) : (
                      shortHash(txHash)
                    )
                  )
                : null}
            </dl>
          </SectionCard>

          <SectionCard
            title="IPFS Review"
            subtitle="Safe snippet reads through injected vibefiIpfs"
            right={<span className="pill">snippet only</span>}
          >
            <div className="studio-form-grid">
              <Field label="CID">
                <input value={reviewCid} onChange={(e) => setReviewCid(e.target.value)} placeholder="bafy..." />
              </Field>
              <Field label="Path" hint="Example: src/App.tsx">
                <input value={reviewPath} onChange={(e) => setReviewPath(e.target.value)} placeholder="src/App.tsx" />
              </Field>
              <button className="btn" onClick={onLoadSnippet}>
                Load Snippet
              </button>
            </div>
            <pre className="studio-snippet">{snippet || "No snippet loaded."}</pre>
          </SectionCard>
        </section>

        <section className="studio-grid-two">
          <SectionCard title="Propose Publish" subtitle="Create governance proposal for publishDapp">
            <div className="studio-form-grid">
              <Field label="Root CID">
                <input value={publishRootCid} onChange={(e) => setPublishRootCid(e.target.value)} placeholder="bafy..." />
              </Field>
              <Field label="Name">
                <input value={publishName} onChange={(e) => setPublishName(e.target.value)} placeholder="VibeFi Studio" />
              </Field>
              <Field label="Version">
                <input value={publishVersion} onChange={(e) => setPublishVersion(e.target.value)} placeholder="0.0.1" />
              </Field>
              <Field label="Description">
                <input
                  value={publishDescription}
                  onChange={(e) => setPublishDescription(e.target.value)}
                  placeholder="Main governance frontend"
                />
              </Field>
              <Field label="Proposal Description">
                <input
                  value={publishProposalDescription}
                  onChange={(e) => setPublishProposalDescription(e.target.value)}
                  placeholder="optional"
                />
              </Field>
              <button className="btn btn-primary" onClick={onProposePublish} disabled={!canAct}>
                Submit Publish Proposal
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Propose Upgrade" subtitle="Create governance proposal for upgradeDapp">
            <div className="studio-form-grid">
              <Field label="Dapp ID" hint="Unsigned integer">
                <input value={upgradeDappId} onChange={(e) => setUpgradeDappId(e.target.value)} placeholder="1" />
              </Field>
              <Field label="New Root CID">
                <input value={upgradeRootCid} onChange={(e) => setUpgradeRootCid(e.target.value)} placeholder="bafy..." />
              </Field>
              <Field label="Name">
                <input value={upgradeName} onChange={(e) => setUpgradeName(e.target.value)} placeholder="VibeFi Studio" />
              </Field>
              <Field label="Version">
                <input value={upgradeVersion} onChange={(e) => setUpgradeVersion(e.target.value)} placeholder="0.0.2" />
              </Field>
              <Field label="Description">
                <input
                  value={upgradeDescription}
                  onChange={(e) => setUpgradeDescription(e.target.value)}
                  placeholder="Updated governance frontend"
                />
              </Field>
              <Field label="Proposal Description">
                <input
                  value={upgradeProposalDescription}
                  onChange={(e) => setUpgradeProposalDescription(e.target.value)}
                  placeholder="optional"
                />
              </Field>
              <button className="btn btn-primary" onClick={onProposeUpgrade} disabled={!canAct}>
                Submit Upgrade Proposal
              </button>
            </div>
          </SectionCard>
        </section>

        <SectionCard
          title="Proposals"
          subtitle="Loaded from deploy block onward"
          right={
            <div className="studio-inline-controls">
              <select value={voteSupport} onChange={(e) => setVoteSupport(e.target.value as "for" | "against" | "abstain")}>
                <option value="for">vote: for</option>
                <option value="against">vote: against</option>
                <option value="abstain">vote: abstain</option>
              </select>
              <input
                value={voteReason}
                onChange={(e) => setVoteReason(e.target.value)}
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
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((proposal) => (
                  <tr key={proposal.proposalId.toString()}>
                    <td>#{proposal.proposalId.toString()}</td>
                    <td>
                      <span className={`state-chip ${proposalStateClass(proposal.state)}`}>{proposal.state}</span>
                    </td>
                    <td>{shortHash(proposal.proposer)}</td>
                    <td>{proposal.description}</td>
                    <td>
                      <div className="studio-actions">
                        <button className="btn" onClick={() => onCastVote(proposal.proposalId)} disabled={!canAct}>
                          Vote
                        </button>
                        <button
                          className="btn"
                          onClick={() => onQueue(proposal)}
                          disabled={!canAct || proposal.state !== "Succeeded"}
                        >
                          Queue
                        </button>
                        <button
                          className="btn"
                          onClick={() => onExecute(proposal)}
                          disabled={!canAct || proposal.state !== "Queued"}
                        >
                          Execute
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {proposals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="studio-empty-cell">
                      No proposals found from deploy block onward.
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
                {dapps.map((item) => (
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
                {dapps.length === 0 ? (
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
      </main>
    </div>
  );
}
