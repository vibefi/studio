import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeFunctionData,
  formatEther,
  hexToString,
  isHex,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import addressesJson from "../addresses.json";
import dappRegistryAbi from "../abis/DappRegistry.json";
import { shortHash } from "./env";
import {
  buildPublicClient,
  buildWalletClient,
  connectWallet,
  getChainId,
  getConnectedAccount,
  switchToChain,
} from "./eth/clients";
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
  type IpfsProgressEvent,
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
const DEFAULT_NETWORKS: AddressesMap = {
  "11155111": {
    name: "Sepolia",
    deployBlock: 10239268,
    vfiGovernor: "0x753d33e2E61F249c87e6D33c4e04b39731776297",
    dappRegistry: "0xFb84B57E757649Dff3870F1381C67c9097D0c67f",
    vfiToken: "0xD11496882E083Ce67653eC655d14487030E548aC",
  },
};
const RESOLVED_ADDRESSES: AddressesMap = Object.fromEntries(
  Array.from(new Set([...Object.keys(DEFAULT_NETWORKS), ...Object.keys(ADDRESSES)])).map((chainKey) => [
    chainKey,
    {
      ...(DEFAULT_NETWORKS[chainKey] ?? {}),
      ...(ADDRESSES[chainKey] ?? {}),
    },
  ])
) as AddressesMap;
const SUPPORTED_CHAIN_IDS = Object.keys(RESOLVED_ADDRESSES)
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isFinite(value));
const DEFAULT_CHAIN_ID = SUPPORTED_CHAIN_IDS[0] ?? 11155111;

function getNetwork(chainId: number | null): NetworkAddresses | null {
  if (!chainId) return null;
  return RESOLVED_ADDRESSES[String(chainId)] ?? null;
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

function Toast(props: { message: string; onClose: () => void }) {
  return (
    <div className="studio-toast" role="status" aria-live="polite">
      <span>{props.message}</span>
      <button className="btn" onClick={props.onClose}>
        Dismiss
      </button>
    </div>
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
const HISTORICAL_STATES = new Set(["Canceled", "Defeated", "Expired", "Executed"]);

type ProposalBundleRef = {
  action: "publishDapp" | "upgradeDapp";
  rootCid: string;
  dappId?: bigint;
};

type StudioPage = "dashboard" | "proposals" | "actions" | "review";
type ReviewWorkspacePage = "summary" | "explorer";

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

function clampProgressPercent(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatProposalIdCompact(proposalId: bigint): string {
  const raw = proposalId.toString();
  if (raw.length <= 12) return `#${raw}`;
  return `#${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

function formatEthBalance(value: bigint | null): string {
  if (value === null) return "--";
  const raw = Number.parseFloat(formatEther(value));
  if (!Number.isFinite(raw)) return formatEther(value);
  if (raw >= 1) return raw.toFixed(4);
  if (raw >= 0.0001) return raw.toFixed(6);
  return raw.toExponential(2);
}

function withLineNumbers(text: string, startLine: number): string {
  const lines = text ? text.split("\n") : [];
  return lines.map((line, idx) => `${String(startLine + idx).padStart(5, " ")} | ${line}`).join("\n");
}

function decodeCidHex(value: Hex): string {
  if (!isHex(value)) return value;
  try {
    return hexToString(value).replace(/\0+$/g, "");
  } catch {
    const bytes = toBytes(value);
    if (bytes.length === 0) return "";
    return value;
  }
}

function sameAddress(a?: Address, b?: Address): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function extractProposalBundleRef(
  proposal: ProposalInfo,
  expectedRegistry?: Address
): ProposalBundleRef | null {
  for (let i = 0; i < proposal.calldatas.length; i += 1) {
    const calldata = proposal.calldatas[i];
    const target = proposal.targets[i];
    if (expectedRegistry && !sameAddress(target, expectedRegistry)) continue;
    try {
      const decoded = decodeFunctionData({ abi: dappRegistryAbi as any, data: calldata });
      if (decoded.functionName === "publishDapp") {
        const rootCidHex = decoded.args?.[0] as Hex | undefined;
        if (!rootCidHex) continue;
        const rootCid = decodeCidHex(rootCidHex);
        if (!rootCid) continue;
        return { action: "publishDapp", rootCid };
      }
      if (decoded.functionName === "upgradeDapp") {
        const dappId = decoded.args?.[0] as bigint | undefined;
        const rootCidHex = decoded.args?.[1] as Hex | undefined;
        if (!rootCidHex) continue;
        const rootCid = decodeCidHex(rootCidHex);
        if (!rootCid) continue;
        return { action: "upgradeDapp", rootCid, dappId };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [publicClient, setPublicClient] = useState<PublicClient | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  const [, setStatus] = useState<string>("Connect wallet to begin");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
  const [proposalView, setProposalView] = useState<"all" | "active" | "historical">("all");
  const [studioPage, setStudioPage] = useState<StudioPage>("dashboard");
  const [reviewWorkspacePage, setReviewWorkspacePage] = useState<ReviewWorkspacePage>("summary");

  const [reviewCid, setReviewCid] = useState("");
  const reviewCidRef = useRef("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewFiles, setReviewFiles] = useState<ReviewFile[]>([]);
  const [selectedReviewPath, setSelectedReviewPath] = useState("");
  const [selectedReviewHead, setSelectedReviewHead] = useState<IpfsHeadResult | null>(null);
  const [selectedReviewSnippet, setSelectedReviewSnippet] = useState<IpfsSnippetResult | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewProgressPercent, setReviewProgressPercent] = useState(0);
  const [reviewProgressMessage, setReviewProgressMessage] = useState("");
  const [reviewProgressIpcId, setReviewProgressIpcId] = useState<number | null>(null);
  const lastAutoRefreshKeyRef = useRef<string | null>(null);

  const network = useMemo(() => getNetwork(chainId), [chainId]);
  const needsSupportedChain = chainId !== null && !network;
  const walletBalance = useMemo(() => formatEthBalance(ethBalance), [ethBalance]);

  function pushToast(message: string) {
    setToast(message);
  }

  function updateReviewCid(value: string) {
    reviewCidRef.current = value;
    setReviewCid(value);
  }

  function reportError(err: unknown, fallbackMessage = "Something went wrong") {
    const message = err instanceof Error ? err.message : fallbackMessage;
    setStatus(message);
    pushToast(message);
  }

  const syncInjectedWalletState = useCallback(async () => {
    try {
      const nextChainId = await getChainId();
      const nextAccount = await getConnectedAccount();

      setChainId(nextChainId);
      setAccount(nextAccount);

      if (nextChainId === null) {
        setPublicClient(null);
        setWalletClient(null);
        setEthBalance(null);
        return;
      }

      setPublicClient(buildPublicClient(nextChainId));
      if (nextAccount) {
        const wallet = await buildWalletClient(nextChainId);
        setWalletClient(wallet);
      } else {
        setWalletClient(null);
      }
    } catch (err) {
      reportError(err, "Failed to sync wallet state");
      setWalletClient(null);
      setPublicClient(null);
      setAccount(null);
      setChainId(null);
      setEthBalance(null);
    }
  }, []);

  useEffect(() => {
    void syncInjectedWalletState();
  }, [syncInjectedWalletState]);

  useEffect(() => {
    let cancelled = false;
    async function refreshBalance() {
      if (!publicClient || !account) {
        setEthBalance(null);
        return;
      }
      try {
        const balance = await publicClient.getBalance({ address: account });
        if (!cancelled) {
          setEthBalance(balance);
        }
      } catch {
        if (!cancelled) {
          setEthBalance(null);
        }
      }
    }
    void refreshBalance();
    return () => {
      cancelled = true;
    };
  }, [publicClient, account, chainId, txHash]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on) return;
    const onProviderChange = () => {
      void syncInjectedWalletState();
    };
    eth.on("accountsChanged", onProviderChange);
    eth.on("chainChanged", onProviderChange);
    return () => {
      eth.removeListener?.("accountsChanged", onProviderChange);
      eth.removeListener?.("chainChanged", onProviderChange);
    };
  }, [syncInjectedWalletState]);

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
      await syncInjectedWalletState();
      setStatus(`Connected ${connected.account} on chain ${connected.chainId}`);
      setTxHash(null);
    } catch (err) {
      reportError(err, "Failed to connect wallet");
    }
  }

  async function onSwitchToSupportedChain() {
    try {
      setStatus(`Switching wallet to chain ${DEFAULT_CHAIN_ID}...`);
      await switchToChain(DEFAULT_CHAIN_ID);
      await syncInjectedWalletState();
      setStatus(`Switched to chain ${DEFAULT_CHAIN_ID}`);
    } catch (err) {
      reportError(err, "Failed to switch chain");
    }
  }

  async function refreshGovernanceData() {
    try {
      const clients = await withClients();
      const fromBlock = blockFrom(clients.network);
      setStatus(
        `Refreshing proposals and registry data from block ${fromBlock.toString()} (gov ${clients.network.vfiGovernor}, reg ${clients.network.dappRegistry})...`
      );
      const [nextProposals, nextDapps] = await Promise.all([
        listProposals(clients.publicClient, clients.network.vfiGovernor, fromBlock),
        listDapps(clients.publicClient, clients.network.dappRegistry, fromBlock),
      ]);
      setProposals(nextProposals);
      setDapps(nextDapps);
      setStatus(`Loaded ${nextProposals.length} proposals and ${nextDapps.length} dapps`);
    } catch (err) {
      reportError(err, "Failed to refresh governance data");
    }
  }

  useEffect(() => {
    if (!(publicClient && walletClient && account && network) || chainId === null) return;
    const key = `${account.toLowerCase()}-${chainId}`;
    if (lastAutoRefreshKeyRef.current === key) return;
    lastAutoRefreshKeyRef.current = key;
    void refreshGovernanceData();
  }, [publicClient, walletClient, account, network, chainId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
      reportError(err, "Failed to submit publish proposal");
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
      reportError(err, "Failed to submit upgrade proposal");
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
      reportError(err, "Failed to cast vote");
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
      reportError(err, "Failed to queue proposal");
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
      reportError(err, "Failed to execute proposal");
    }
  }

  function onIpfsProgress(progress: IpfsProgressEvent, fallbackMessage: string) {
    setReviewProgressIpcId(progress.ipcId);
    if (typeof progress.percent === "number") {
      setReviewProgressPercent(clampProgressPercent(progress.percent));
    }
    const nextMessage = progress.message?.trim() || fallbackMessage;
    setReviewProgressMessage(nextMessage);
  }

  async function loadSnippetWindow(
    path: string,
    startLine: number,
    manageLoading = true,
    cidInput?: string
  ) {
    try {
      const cid = (cidInput ?? reviewCidRef.current).trim();
      if (!cid) {
        throw new Error("CID is required");
      }
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        throw new Error("File path is required");
      }

      const loadingMessage = `Loading ${normalizedPath} from injected IPFS...`;
      if (manageLoading) {
        setReviewLoading(true);
        setReviewProgressPercent(0);
        setReviewProgressMessage(loadingMessage);
        setReviewProgressIpcId(null);
      }
      setStatus(loadingMessage);

      const progress = (event: IpfsProgressEvent) => onIpfsProgress(event, loadingMessage);
      const head = await ipfsHead(cid, normalizedPath, { onProgress: progress });
      const snippet = await ipfsReadSnippet(
        cid,
        normalizedPath,
        Math.max(1, startLine),
        SNIPPET_PAGE_LINES,
        undefined,
        { onProgress: progress }
      );

      setSelectedReviewPath(normalizedPath);
      setSelectedReviewHead(head);
      setSelectedReviewSnippet(snippet);
      setReviewProgressPercent(100);
      setReviewProgressMessage(`Loaded ${normalizedPath}`);
      setStatus(`Loaded ${normalizedPath}:${snippet.lineStart}-${snippet.lineEnd}`);
    } catch (err) {
      reportError(err, "Failed to load review snippet");
    } finally {
      if (manageLoading) {
        setReviewLoading(false);
      }
    }
  }

  async function loadReviewBundle(cidInput: string) {
    try {
      const cid = cidInput.trim();
      if (!cid) {
        throw new Error("CID is required");
      }

      updateReviewCid(cid);

      setReviewLoading(true);
      setReviewProgressPercent(0);
      setReviewProgressMessage("Loading packaged vapp file index...");
      setReviewProgressIpcId(null);
      setStatus("Loading packaged vapp file index...");
      const listing = await ipfsList(cid, "", {
        onProgress: (progress) => onIpfsProgress(progress, "Loading packaged vapp file index..."),
      });
      const files = listing.files
        .map((file) => ({ ...file, isCode: isLikelyCodeFile(file.path) }))
        .sort((a, b) => Number(b.isCode) - Number(a.isCode) || a.path.localeCompare(b.path));
      setReviewFiles(files);
      setReviewQuery("");

      if (files.length === 0) {
        setSelectedReviewPath("");
        setSelectedReviewHead(null);
        setSelectedReviewSnippet(null);
        setReviewProgressPercent(100);
        setReviewProgressMessage("Manifest loaded. No files found in scope.");
        setStatus("No files found in manifest scope");
        return;
      }
      setStatus(`Loaded ${files.length} files from manifest`);
      const firstCodeFile = files.find((file) => file.isCode) ?? files[0];
      await loadSnippetWindow(firstCodeFile.path, 1, false, cid);
      setReviewProgressPercent(100);
      setReviewProgressMessage("Bundle review workspace ready.");
    } catch (err) {
      reportError(err, "Failed to load review bundle");
      setReviewFiles([]);
      setSelectedReviewPath("");
      setSelectedReviewHead(null);
      setSelectedReviewSnippet(null);
    } finally {
      setReviewLoading(false);
    }
  }

  async function onLoadReviewBundle() {
    await loadReviewBundle(reviewCidRef.current || reviewCid);
  }

  async function onOpenTypedReviewPath() {
    await loadSnippetWindow(selectedReviewPath, 1, true, reviewCidRef.current);
  }

  async function onOpenReviewFile(path: string) {
    await loadSnippetWindow(path, 1, true, reviewCidRef.current);
  }

  async function onReviewProposalBundle(proposal: ProposalInfo) {
    const ref = extractProposalBundleRef(proposal, network?.dappRegistry);
    if (!ref) {
      const message = `Proposal #${proposal.proposalId.toString()} does not include a publish/upgrade bundle CID`;
      setStatus(message);
      pushToast(message);
      return;
    }
    setStudioPage("review");
    setReviewWorkspacePage("explorer");
    updateReviewCid(ref.rootCid);
    setSelectedReviewPath("");
    setSelectedReviewHead(null);
    setSelectedReviewSnippet(null);
    setStatus(`Loading bundle CID from proposal #${proposal.proposalId.toString()} (${ref.action})...`);
    await loadReviewBundle(ref.rootCid);
  }

  const canAct = !!(publicClient && walletClient && account && network);
  const filteredReviewFiles = useMemo(() => {
    const needle = reviewQuery.trim().toLowerCase();
    if (!needle) return reviewFiles;
    return reviewFiles.filter((file) => file.path.toLowerCase().includes(needle));
  }, [reviewFiles, reviewQuery]);
  const renderedSnippet = selectedReviewSnippet
    ? withLineNumbers(selectedReviewSnippet.text, selectedReviewSnippet.lineStart)
    : "No file loaded.";
  const visibleProposals = useMemo(() => {
    if (proposalView === "all") return proposals;
    if (proposalView === "historical") {
      return proposals.filter((proposal) => HISTORICAL_STATES.has(proposal.state));
    }
    return proposals.filter((proposal) => !HISTORICAL_STATES.has(proposal.state));
  }, [proposals, proposalView]);
  const proposalRows = useMemo(() => {
    return visibleProposals
      .filter((proposal) => proposal && typeof proposal.proposalId === "bigint")
      .map((proposal) => ({
        proposal,
        bundleRef: extractProposalBundleRef(proposal, network?.dappRegistry),
      }));
  }, [visibleProposals, network?.dappRegistry]);
  const proposalStateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of proposals) {
      counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
    }
    return counts;
  }, [proposals]);
  const queuedActions = useMemo(
    () =>
      proposalRows.filter(({ proposal }) =>
        proposal.state === "Active" || proposal.state === "Succeeded" || proposal.state === "Queued"
      ),
    [proposalRows]
  );
  const recentDapps = useMemo(() => dapps.slice(0, 8), [dapps]);
  const reviewCodeFileCount = useMemo(() => reviewFiles.filter((file) => file.isCode).length, [reviewFiles]);

  return (
    <div className="studio-shell">
      <div className="studio-atmosphere" aria-hidden="true" />
      <main className="studio-page">
        <header className="studio-topbar">
          <div className="studio-topbar-brand">
            <div className="studio-eyebrow">VibeFi DAO Console</div>
            <h1>Studio</h1>
          </div>
          <div className="studio-topbar-wallet">
            {chainId !== null ? <span className="studio-topbar-chip">chain {chainId}</span> : null}
            {account ? (
              <>
                <span className="studio-topbar-balance">Ξ {walletBalance}</span>
                <span className="studio-topbar-chip">{shortHash(account)}</span>
                {needsSupportedChain ? (
                  <button className="btn" onClick={onSwitchToSupportedChain}>
                    Switch to Supported Chain
                  </button>
                ) : null}
              </>
            ) : (
              <button className="btn btn-primary" onClick={onConnect}>
                Connect Wallet
              </button>
            )}
          </div>
        </header>
        <div className="studio-page-nav">
          <button
            className={`btn ${studioPage === "dashboard" ? "btn-primary" : ""}`}
            onClick={() => setStudioPage("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`btn ${studioPage === "proposals" ? "btn-primary" : ""}`}
            onClick={() => setStudioPage("proposals")}
          >
            Proposals
          </button>
          <button
            className={`btn ${studioPage === "actions" ? "btn-primary" : ""}`}
            onClick={() => setStudioPage("actions")}
          >
            Actions
          </button>
          <button
            className={`btn ${studioPage === "review" ? "btn-primary" : ""}`}
            onClick={() => setStudioPage("review")}
          >
            Review
          </button>
        </div>
        {needsSupportedChain ? (
          <div className="studio-inline-note">Studio supports chain {DEFAULT_CHAIN_ID} for this build.</div>
        ) : null}

        {studioPage === "dashboard" ? (
          <>
            <section className="studio-metrics">
              <article className="studio-metric-card">
                <span>Proposals</span>
                <strong>{proposals.length}</strong>
              </article>
              <article className="studio-metric-card">
                <span>Active</span>
                <strong>{proposalStateCounts.get("Active") ?? 0}</strong>
              </article>
              <article className="studio-metric-card">
                <span>Ready To Queue</span>
                <strong>{proposalStateCounts.get("Succeeded") ?? 0}</strong>
              </article>
              <article className="studio-metric-card">
                <span>Queued</span>
                <strong>{proposalStateCounts.get("Queued") ?? 0}</strong>
              </article>
              <article className="studio-metric-card">
                <span>Executed</span>
                <strong>{proposalStateCounts.get("Executed") ?? 0}</strong>
              </article>
              <article className="studio-metric-card">
                <span>Registry Entries</span>
                <strong>{dapps.length}</strong>
              </article>
            </section>

            <SectionCard title="Priority Queue" subtitle="Top proposals that need governance actions">
              <div className="studio-list">
                {queuedActions.slice(0, 8).map(({ proposal, bundleRef }) => (
                  <div className="studio-list-item" key={`dashboard-${proposal.proposalId.toString()}`}>
                    <div>
                      <strong>#{proposal.proposalId.toString()}</strong>{" "}
                      <span className={`state-chip ${proposalStateClass(proposal.state)}`}>{proposal.state}</span>
                      <p>{proposal.description}</p>
                    </div>
                    <div className="studio-actions">
                      <button
                        className="btn"
                        onClick={() => onReviewProposalBundle(proposal)}
                        disabled={!bundleRef?.rootCid || reviewLoading}
                      >
                        Review
                      </button>
                      <button className="btn" onClick={() => onCastVote(proposal.proposalId)} disabled={!canAct}>
                        Vote
                      </button>
                      <button className="btn" onClick={() => onQueue(proposal)} disabled={!canAct || proposal.state !== "Succeeded"}>
                        Queue
                      </button>
                      <button className="btn" onClick={() => onExecute(proposal)} disabled={!canAct || proposal.state !== "Queued"}>
                        Execute
                      </button>
                    </div>
                  </div>
                ))}
                {queuedActions.length === 0 ? <div className="studio-empty-cell">No actionable proposals right now.</div> : null}
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
                    {recentDapps.map((item) => (
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
                    {recentDapps.length === 0 ? (
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
        ) : null}

        {studioPage === "actions" ? (
          <>
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
                    {queuedActions.map(({ proposal, bundleRef }) => (
                      <tr key={`action-${proposal.proposalId.toString()}`}>
                        <td>#{proposal.proposalId.toString()}</td>
                        <td>
                          <span className={`state-chip ${proposalStateClass(proposal.state)}`}>{proposal.state}</span>
                        </td>
                        <td>{proposal.description}</td>
                        <td>
                          <div className="studio-actions">
                            <button
                              className="btn"
                              onClick={() => onReviewProposalBundle(proposal)}
                              disabled={!bundleRef?.rootCid || reviewLoading}
                            >
                              Review
                            </button>
                            <button className="btn" onClick={() => onCastVote(proposal.proposalId)} disabled={!canAct}>
                              Vote
                            </button>
                            <button className="btn" onClick={() => onQueue(proposal)} disabled={!canAct || proposal.state !== "Succeeded"}>
                              Queue
                            </button>
                            <button className="btn" onClick={() => onExecute(proposal)} disabled={!canAct || proposal.state !== "Queued"}>
                              Execute
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {queuedActions.length === 0 ? (
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
        ) : null}

        {studioPage === "proposals" ? (
          <>
            <SectionCard
              title="Proposals"
              subtitle="Loaded from deploy block onward, including historical and executed proposals"
              right={
                <div className="studio-inline-controls">
                  <select value={proposalView} onChange={(e) => setProposalView(e.target.value as "all" | "active" | "historical")}>
                    <option value="all">view: all</option>
                    <option value="active">view: active/open</option>
                    <option value="historical">view: historical/executed</option>
                  </select>
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
                      <th>Bundle CID</th>
                      <th>Description</th>
                      <th className="studio-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposalRows.map(({ proposal, bundleRef }) => (
                      <tr key={proposal.proposalId.toString()}>
                        <td title={`#${proposal.proposalId.toString()}`}>{formatProposalIdCompact(proposal.proposalId)}</td>
                        <td>
                          <span className={`state-chip ${proposalStateClass(proposal.state)}`}>{proposal.state}</span>
                        </td>
                        <td>{shortHash(proposal.proposer)}</td>
                        <td>{bundleRef?.rootCid ? <code>{shortHash(bundleRef.rootCid)}</code> : "-"}</td>
                        <td>{proposal.description}</td>
                        <td className="studio-col-actions">
                          <div className="studio-actions">
                            <button
                              className="btn"
                              onClick={() => onReviewProposalBundle(proposal)}
                              disabled={!bundleRef?.rootCid || reviewLoading}
                            >
                              Review Bundle
                            </button>
                            <button className="btn" onClick={() => onCastVote(proposal.proposalId)} disabled={!canAct}>
                              Vote
                            </button>
                            <button className="btn" onClick={() => onQueue(proposal)} disabled={!canAct || proposal.state !== "Succeeded"}>
                              Queue
                            </button>
                            <button className="btn" onClick={() => onExecute(proposal)} disabled={!canAct || proposal.state !== "Queued"}>
                              Execute
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {proposalRows.length === 0 ? (
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
          </>
        ) : null}

        {studioPage === "review" ? (
          <SectionCard
            title="Code Review Workspace"
            subtitle="Split between bundle summary and deep file explorer"
            right={
              <div className="studio-inline-controls">
                <button
                  className={`btn ${reviewWorkspacePage === "summary" ? "btn-primary" : ""}`}
                  onClick={() => setReviewWorkspacePage("summary")}
                >
                  Summary
                </button>
                <button
                  className={`btn ${reviewWorkspacePage === "explorer" ? "btn-primary" : ""}`}
                  onClick={() => setReviewWorkspacePage("explorer")}
                >
                  Explorer
                </button>
              </div>
            }
          >
            <div className="studio-review-controls">
              <Field label="Bundle CID">
                <input value={reviewCid} onChange={(e) => updateReviewCid(e.target.value)} placeholder="bafy..." />
              </Field>
              <button className="btn btn-primary" onClick={onLoadReviewBundle} disabled={reviewLoading}>
                Load Manifest Files
              </button>
            </div>
            {reviewLoading ? (
              <div className="studio-progress" role="status" aria-live="polite">
                <div className="studio-progress-head">
                  <span>{reviewProgressMessage || "Loading review workspace..."}</span>
                  <span>{clampProgressPercent(reviewProgressPercent)}%</span>
                </div>
                <div className="studio-progress-track">
                  <div
                    className="studio-progress-bar"
                    style={{ width: `${clampProgressPercent(reviewProgressPercent)}%` }}
                  />
                </div>
                {reviewProgressIpcId !== null ? (
                  <div className="studio-progress-meta">IPC #{reviewProgressIpcId}</div>
                ) : null}
              </div>
            ) : null}

            {reviewWorkspacePage === "summary" ? (
              <>
                <section className="studio-metrics">
                  <article className="studio-metric-card">
                    <span>Manifest Files</span>
                    <strong>{reviewFiles.length}</strong>
                  </article>
                  <article className="studio-metric-card">
                    <span>Code Files</span>
                    <strong>{reviewCodeFileCount}</strong>
                  </article>
                  <article className="studio-metric-card">
                    <span>Data Files</span>
                    <strong>{Math.max(0, reviewFiles.length - reviewCodeFileCount)}</strong>
                  </article>
                  <article className="studio-metric-card">
                    <span>Bidi Flags</span>
                    <strong>{selectedReviewSnippet?.hasBidiControls ? "Detected" : "None"}</strong>
                  </article>
                </section>

                <section className="studio-grid-two">
                  <SectionCard title="Selected File Snapshot" subtitle="High-level file metadata and current snippet">
                    <div className="studio-review-meta">
                      <div className="studio-review-meta-row">
                        <span className="studio-review-meta-key">Path</span>
                        <span className="studio-review-meta-value">{selectedReviewPath || "-"}</span>
                      </div>
                      <div className="studio-review-meta-row">
                        <span className="studio-review-meta-key">Range</span>
                        <span className="studio-review-meta-value">
                          {selectedReviewSnippet ? `${selectedReviewSnippet.lineStart}-${selectedReviewSnippet.lineEnd}` : "-"}
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
                    </div>
                    <pre className="studio-snippet">{renderedSnippet}</pre>
                  </SectionCard>

                  <SectionCard title="File Manifest" subtitle="Browse and open files directly from manifest listing">
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
                          key={`summary-${file.path}`}
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
                      {filteredReviewFiles.length === 0 ? <div className="studio-review-empty">No files match the current filter.</div> : null}
                    </div>
                  </SectionCard>
                </section>
              </>
            ) : (
              <>
                <div className="studio-review-open-controls">
                  <Field label="Open File Path">
                    <input
                      value={selectedReviewPath}
                      onChange={(e) => setSelectedReviewPath(e.target.value)}
                      placeholder="src/App.tsx"
                    />
                  </Field>
                  <button className="btn btn-primary studio-review-open-btn" onClick={onOpenTypedReviewPath} disabled={reviewLoading}>
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
                          {selectedReviewSnippet ? `${selectedReviewSnippet.lineStart}-${selectedReviewSnippet.lineEnd}` : "-"}
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
                    </div>
                    <pre className="studio-snippet studio-review-snippet">{renderedSnippet}</pre>
                  </section>
                </div>
              </>
            )}
          </SectionCard>
        ) : null}
        {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
      </main>
    </div>
  );
}
