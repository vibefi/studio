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

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section style={{ border: "1px solid #d8d8d8", borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function row(label: string, value: React.ReactNode) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, marginBottom: 6 }}>
      <div style={{ color: "#666" }}>{label}</div>
      <div>{value}</div>
    </div>
  );
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
          dappId: BigInt(upgradeDappId),
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
      const result = await ipfsReadSnippet(reviewCid, reviewPath, 1, 220) as { text?: string };
      setSnippet(result.text ?? "");
      setStatus("Snippet loaded");
    } catch (err) {
      setStatus((err as Error).message);
      setSnippet("");
    }
  }

  const canAct = !!(publicClient && walletClient && account && network);

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>VibeFi Studio</h1>
      <p style={{ marginTop: 4, color: "#555" }}>
        Governance entrypoint for publish/upgrade proposals, voting, queue/execute, and registry verification.
      </p>

      <Section title="Connection">
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={onConnect}>Connect Wallet</button>
          <button onClick={refreshGovernanceData} disabled={!canAct}>Refresh</button>
        </div>
        {row("Account", account ? shortHash(account) : "not connected")}
        {row("Chain", chainId ?? "unknown")}
        {row("Network", network?.name ?? "unsupported")}
        {row("Governor", network?.vfiGovernor ?? "n/a")}
        {row("Registry", network?.dappRegistry ?? "n/a")}
        {row("Status", status)}
        {txHash && row("Last tx", <a href={txUrl(chainId, txHash) || "#"} target="_blank" rel="noreferrer">{txHash}</a>)}
      </Section>

      <Section title="Propose Publish">
        <div style={{ display: "grid", gap: 8 }}>
          <input value={publishRootCid} onChange={(e) => setPublishRootCid(e.target.value)} placeholder="root CID" />
          <input value={publishName} onChange={(e) => setPublishName(e.target.value)} placeholder="name" />
          <input value={publishVersion} onChange={(e) => setPublishVersion(e.target.value)} placeholder="dapp version" />
          <input value={publishDescription} onChange={(e) => setPublishDescription(e.target.value)} placeholder="description" />
          <input value={publishProposalDescription} onChange={(e) => setPublishProposalDescription(e.target.value)} placeholder="proposal description (optional)" />
          <button onClick={onProposePublish} disabled={!canAct}>Submit Publish Proposal</button>
        </div>
      </Section>

      <Section title="Propose Upgrade">
        <div style={{ display: "grid", gap: 8 }}>
          <input value={upgradeDappId} onChange={(e) => setUpgradeDappId(e.target.value)} placeholder="dapp id" />
          <input value={upgradeRootCid} onChange={(e) => setUpgradeRootCid(e.target.value)} placeholder="new root CID" />
          <input value={upgradeName} onChange={(e) => setUpgradeName(e.target.value)} placeholder="name" />
          <input value={upgradeVersion} onChange={(e) => setUpgradeVersion(e.target.value)} placeholder="dapp version" />
          <input value={upgradeDescription} onChange={(e) => setUpgradeDescription(e.target.value)} placeholder="description" />
          <input value={upgradeProposalDescription} onChange={(e) => setUpgradeProposalDescription(e.target.value)} placeholder="proposal description (optional)" />
          <button onClick={onProposeUpgrade} disabled={!canAct}>Submit Upgrade Proposal</button>
        </div>
      </Section>

      <Section title="Proposals (Deploy Block Onward)">
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <select value={voteSupport} onChange={(e) => setVoteSupport(e.target.value as "for" | "against" | "abstain")}>
            <option value="for">for</option>
            <option value="against">against</option>
            <option value="abstain">abstain</option>
          </select>
          <input value={voteReason} onChange={(e) => setVoteReason(e.target.value)} placeholder="vote reason (optional)" />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>ID</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>State</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Proposer</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Description</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((proposal) => (
                <tr key={proposal.proposalId.toString()}>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>{proposal.proposalId.toString()}</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>{proposal.state}</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>{shortHash(proposal.proposer)}</td>
                  <td style={{ borderBottom: "1px solid #eee", maxWidth: 420 }}>{proposal.description}</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => onCastVote(proposal.proposalId)} disabled={!canAct}>Vote</button>
                      <button onClick={() => onQueue(proposal)} disabled={!canAct || proposal.state !== "Succeeded"}>Queue</button>
                      <button onClick={() => onExecute(proposal)} disabled={!canAct || proposal.state !== "Queued"}>Execute</button>
                    </div>
                  </td>
                </tr>
              ))}
              {proposals.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "12px 0", color: "#777" }}>No proposals found from deploy block onward.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Registry Verification (Step 7)">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Dapp</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Version ID</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Name/Version</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Status</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Root CID</th>
              </tr>
            </thead>
            <tbody>
              {dapps.map((item) => (
                <tr key={`${item.dappId.toString()}-${item.versionId.toString()}`}>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>#{item.dappId.toString()}</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>{item.versionId.toString()}</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>{item.name} ({item.version})</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>{item.status}</td>
                  <td style={{ borderBottom: "1px solid #eee" }}>{item.rootCid || "-"}</td>
                </tr>
              ))}
              {dapps.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "12px 0", color: "#777" }}>No dapp registry entries found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="IPFS Code Review (Safe Snippet View)">
        <div style={{ display: "grid", gap: 8 }}>
          <input value={reviewCid} onChange={(e) => setReviewCid(e.target.value)} placeholder="CID" />
          <input value={reviewPath} onChange={(e) => setReviewPath(e.target.value)} placeholder="path (e.g. src/App.tsx)" />
          <button onClick={onLoadSnippet}>Load Snippet via vibefiIpfs</button>
          <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflow: "auto", whiteSpace: "pre-wrap" }}>{snippet}</pre>
        </div>
      </Section>
    </main>
  );
}
