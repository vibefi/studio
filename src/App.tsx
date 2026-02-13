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
import {
  ipfsHead,
  ipfsList,
  ipfsReadSnippet,
  type IpfsHeadResult,
  type IpfsListFile,
  type IpfsSnippetResult,
} from "./ipfs/client";

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

type ReviewFile = IpfsListFile & {
  isCode: boolean;
};

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "sol",
  "rs",
  "toml",
  "css",
  "scss",
  "md",
  "txt",
  "yaml",
  "yml",
  "html",
  "sh",
]);

const SNIPPET_PAGE_LINES = 180;

function extensionFor(path: string): string {
  const trimmed = path.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === trimmed.length - 1) return "";
  return trimmed.slice(dotIndex + 1).toLowerCase();
}

function isLikelyCodeFile(path: string): boolean {
  const ext = extensionFor(path);
  return CODE_EXTENSIONS.has(ext);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  return `${(kb / 1024).toFixed(2)} MiB`;
}

function withLineNumbers(text: string, startLine: number): string {
  const lines = text ? text.split("\n") : [];
  return lines.map((line, idx) => `${String(startLine + idx).padStart(5, " ")} | ${line}`).join("\n");
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
  const [reviewBasePath, setReviewBasePath] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewFiles, setReviewFiles] = useState<ReviewFile[]>([]);
  const [selectedReviewPath, setSelectedReviewPath] = useState("");
  const [selectedReviewHead, setSelectedReviewHead] = useState<IpfsHeadResult | null>(null);
  const [selectedReviewSnippet, setSelectedReviewSnippet] = useState<IpfsSnippetResult | null>(null);
  const [reviewStartLine, setReviewStartLine] = useState(1);
  const [reviewLoading, setReviewLoading] = useState(false);

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

  async function loadSnippetWindow(path: string, startLine: number) {
    try {
      const cid = reviewCid.trim();
      if (!cid) {
        throw new Error("CID is required");
      }
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        throw new Error("File path is required");
      }

      setReviewLoading(true);
      setStatus(`Loading ${normalizedPath} from injected vibefiIpfs...`);
      const [head, snippet] = await Promise.all([
        ipfsHead(cid, normalizedPath),
        ipfsReadSnippet(cid, normalizedPath, Math.max(1, startLine), SNIPPET_PAGE_LINES),
      ]);

      setSelectedReviewPath(normalizedPath);
      setSelectedReviewHead(head);
      setSelectedReviewSnippet(snippet);
      setReviewStartLine(snippet.lineStart);
      setStatus(`Loaded ${normalizedPath}:${snippet.lineStart}-${snippet.lineEnd}`);
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setReviewLoading(false);
    }
  }

  async function onLoadReviewBundle() {
    try {
      const cid = reviewCid.trim();
      if (!cid) {
        throw new Error("CID is required");
      }

      setReviewLoading(true);
      setStatus("Loading packaged vapp file index...");
      const listing = await ipfsList(cid, reviewBasePath.trim());
      const files = listing.files
        .map((file) => ({ ...file, isCode: isLikelyCodeFile(file.path) }))
        .sort((a, b) => Number(b.isCode) - Number(a.isCode) || a.path.localeCompare(b.path));
      setReviewFiles(files);
      setReviewQuery("");

      if (files.length === 0) {
        setSelectedReviewPath("");
        setSelectedReviewHead(null);
        setSelectedReviewSnippet(null);
        setStatus("No files found in manifest scope");
        return;
      }
      setStatus(`Loaded ${files.length} files from manifest`);
      const firstCodeFile = files.find((file) => file.isCode) ?? files[0];
      await loadSnippetWindow(firstCodeFile.path, 1);
    } catch (err) {
      setStatus((err as Error).message);
      setReviewFiles([]);
      setSelectedReviewPath("");
      setSelectedReviewHead(null);
      setSelectedReviewSnippet(null);
    } finally {
      setReviewLoading(false);
    }
  }

  async function onOpenTypedReviewPath() {
    await loadSnippetWindow(selectedReviewPath, 1);
  }

  async function onOpenReviewFile(path: string) {
    await loadSnippetWindow(path, 1);
  }

  async function onReviewPrevPage() {
    if (!selectedReviewPath || !selectedReviewSnippet) return;
    await loadSnippetWindow(selectedReviewPath, Math.max(1, reviewStartLine - SNIPPET_PAGE_LINES));
  }

  async function onReviewNextPage() {
    if (!selectedReviewPath || !selectedReviewSnippet?.truncatedTail) return;
    await loadSnippetWindow(selectedReviewPath, selectedReviewSnippet.lineEnd + 1);
  }

  const canAct = !!(publicClient && walletClient && account && network);
  const latestTxUrl = txHash ? txUrl(chainId, txHash) : "";
  const filteredReviewFiles = useMemo(() => {
    const needle = reviewQuery.trim().toLowerCase();
    if (!needle) return reviewFiles;
    return reviewFiles.filter((file) => file.path.toLowerCase().includes(needle));
  }, [reviewFiles, reviewQuery]);
  const renderedSnippet = selectedReviewSnippet
    ? withLineNumbers(selectedReviewSnippet.text, selectedReviewSnippet.lineStart)
    : "No file loaded.";

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
            title="Packaged Vapp Code Review"
            subtitle="Manifest-aware review over injected vibefiIpfs snippet reads"
            right={<span className="pill">safe preview</span>}
          >
            <div className="studio-review-controls">
              <Field label="Bundle CID">
                <input value={reviewCid} onChange={(e) => setReviewCid(e.target.value)} placeholder="bafy..." />
              </Field>
              <Field label="Base Path" hint="Optional path prefix to scope review">
                <input value={reviewBasePath} onChange={(e) => setReviewBasePath(e.target.value)} placeholder="" />
              </Field>
              <button className="btn btn-primary" onClick={onLoadReviewBundle} disabled={reviewLoading}>
                Load Manifest Files
              </button>
            </div>

            <div className="studio-review-controls">
              <Field label="Open File Path" hint="Exact path from manifest listing">
                <input
                  value={selectedReviewPath}
                  onChange={(e) => setSelectedReviewPath(e.target.value)}
                  placeholder="src/App.tsx"
                />
              </Field>
              <button className="btn" onClick={onOpenTypedReviewPath} disabled={reviewLoading}>
                Open Path
              </button>
            </div>

            <div className="studio-review-layout">
              <aside className="studio-review-files">
                <div className="studio-review-files-head">
                  <strong>Files ({filteredReviewFiles.length}/{reviewFiles.length})</strong>
                  <input
                    value={reviewQuery}
                    onChange={(e) => setReviewQuery(e.target.value)}
                    placeholder="Filter files..."
                  />
                </div>
                <div className="studio-review-file-list">
                  {filteredReviewFiles.map((file) => (
                    <button
                      key={file.path}
                      className={`studio-review-file-btn ${file.path === selectedReviewPath ? "active" : ""}`}
                      onClick={() => onOpenReviewFile(file.path)}
                      disabled={reviewLoading}
                    >
                      <span className={file.isCode ? "studio-badge-code" : "studio-badge-data"}>
                        {file.isCode ? "code" : "data"}
                      </span>
                      <span className="studio-review-file-path">{file.path}</span>
                      <span className="studio-review-file-size">{formatBytes(file.bytes)}</span>
                    </button>
                  ))}
                  {filteredReviewFiles.length === 0 ? (
                    <div className="studio-review-empty">No files match the current filter.</div>
                  ) : null}
                </div>
              </aside>

              <section className="studio-review-preview">
                <div className="studio-review-meta">
                  <div className="studio-review-meta-row">
                    <span className="studio-review-meta-key">Path</span>
                    <span className="studio-review-meta-value">{selectedReviewPath || "-"}</span>
                  </div>
                  <div className="studio-review-meta-row">
                    <span className="studio-review-meta-key">Range</span>
                    <span className="studio-review-meta-value">
                      {selectedReviewSnippet
                        ? `${selectedReviewSnippet.lineStart}-${selectedReviewSnippet.lineEnd}`
                        : "-"}
                    </span>
                  </div>
                  <div className="studio-review-meta-row">
                    <span className="studio-review-meta-key">Size</span>
                    <span className="studio-review-meta-value">
                      {selectedReviewHead ? formatBytes(selectedReviewHead.size) : "-"}
                    </span>
                  </div>
                  <div className="studio-review-meta-row">
                    <span className="studio-review-meta-key">Content-Type</span>
                    <span className="studio-review-meta-value">{selectedReviewHead?.contentType ?? "-"}</span>
                  </div>
                  <div className="studio-review-meta-row">
                    <span className="studio-review-meta-key">Flags</span>
                    <span className="studio-review-meta-value">
                      {selectedReviewSnippet?.hasBidiControls ? "bidi-control-chars-detected" : "none"}
                    </span>
                  </div>
                </div>

                <div className="studio-review-pagination">
                  <button
                    className="btn"
                    onClick={onReviewPrevPage}
                    disabled={reviewLoading || !selectedReviewSnippet || selectedReviewSnippet.lineStart <= 1}
                  >
                    Previous Lines
                  </button>
                  <button
                    className="btn"
                    onClick={onReviewNextPage}
                    disabled={reviewLoading || !selectedReviewSnippet || !selectedReviewSnippet.truncatedTail}
                  >
                    Next Lines
                  </button>
                </div>
                <pre className="studio-snippet studio-review-snippet">{renderedSnippet}</pre>
              </section>
            </div>
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
