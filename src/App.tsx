import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { Toast } from "./components/StudioUi";
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
  type ProposalRuntimeInfo,
  castVote,
  executeProposal,
  getProposerEligibility,
  listProposals,
  loadProposalRuntimeData,
  queueProposal,
  waitForProposalCreated,
} from "./eth/governor";
import { listDapps, proposePublish, proposeUpgrade, type DappRow } from "./eth/registry";
import {
  ipfsHead,
  ipfsList,
  ipfsReadSnippet,
  type IpfsHeadResult,
  type IpfsProgressEvent,
  type IpfsSnippetResult,
} from "./ipfs/client";
import { ActionsPage } from "./features/pages/ActionsPage";
import { DashboardPage } from "./features/pages/DashboardPage";
import { ProposalsPage } from "./features/pages/ProposalsPage";
import { ReviewPage } from "./features/pages/ReviewPage";
import {
  DEFAULT_CHAIN_ID,
  HISTORICAL_STATES,
  blockFrom,
  clampProgressPercent,
  extractProposalBundleRef,
  formatEthBalance,
  getNetwork,
  isLikelyCodeFile,
  parseDappId,
  withLineNumbers,
  type ProposalWithBundle,
  type ReviewFile,
  type ReviewWorkspacePage,
  type StudioPage,
} from "./features/studio-model";

const SNIPPET_PAGE_LINES = 180;
const PROPOSAL_INDEX_RETRY_COUNT = 8;
const PROPOSAL_INDEX_RETRY_DELAY_MS = 1500;

type ProposalFilter = "all" | "active" | "historical";
type VoteSupport = "for" | "against" | "abstain";
type PublishFormField = "rootCid" | "name" | "version" | "description" | "proposalDescription";
type UpgradeFormField =
  | "dappId"
  | "rootCid"
  | "name"
  | "version"
  | "description"
  | "proposalDescription";

export function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [publicClient, setPublicClient] = useState<PublicClient | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  const [status, setStatus] = useState<string>("Connect wallet to begin");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "info" | "error" } | null>(null);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<{
    kind: "pending" | "success" | "error";
    message: string;
  } | null>(null);

  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [dapps, setDapps] = useState<DappRow[]>([]);
  const [proposalRuntimeById, setProposalRuntimeById] = useState<Record<string, ProposalRuntimeInfo>>({});
  const [chainHead, setChainHead] = useState<{ blockNumber: bigint; blockTimestamp: bigint } | null>(null);
  const [pendingGovernanceActionByProposalId, setPendingGovernanceActionByProposalId] = useState<
    Record<string, "vote" | "queue" | "execute" | null>
  >({});

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

  const [voteSupport, setVoteSupport] = useState<VoteSupport>("for");
  const [voteReason, setVoteReason] = useState("");
  const [proposalView, setProposalView] = useState<ProposalFilter>("all");
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

  function pushToast(message: string, tone: "success" | "info" | "error" = "info") {
    setToast({ message, tone });
  }

  function updateReviewCid(value: string) {
    reviewCidRef.current = value;
    setReviewCid(value);
  }

  function setGovernanceActionPending(
    proposalId: bigint,
    action: "vote" | "queue" | "execute" | null
  ) {
    const key = proposalId.toString();
    setPendingGovernanceActionByProposalId((prev) => ({ ...prev, [key]: action }));
  }

  function extractErrorMessage(err: unknown, fallbackMessage: string): string {
    if (err instanceof Error && err.message) return err.message;
    if (err && typeof err === "object") {
      const rec = err as Record<string, unknown>;
      const messageFields = ["shortMessage", "details", "reason", "message"];
      for (const field of messageFields) {
        const value = rec[field];
        if (typeof value === "string" && value.trim()) {
          return value;
        }
      }
      const cause = rec.cause;
      if (cause && typeof cause === "object") {
        const causeMessage = (cause as Record<string, unknown>).message;
        if (typeof causeMessage === "string" && causeMessage.trim()) {
          return causeMessage;
        }
      }
    }
    return fallbackMessage;
  }

  function reportError(err: unknown, fallbackMessage = "Something went wrong") {
    const message = extractErrorMessage(err, fallbackMessage);
    console.error("[studio] action failed", { fallbackMessage, err });
    setStatus(message);
    pushToast(message, "error");
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

  async function refreshGovernanceData(): Promise<{ proposals: ProposalInfo[]; dapps: DappRow[] } | null> {
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
      try {
        const runtime = await loadProposalRuntimeData(
          clients.publicClient,
          clients.network.vfiGovernor,
          nextProposals,
          clients.account,
          fromBlock
        );
        setProposalRuntimeById(runtime.byProposalId);
        setChainHead({ blockNumber: runtime.blockNumber, blockTimestamp: runtime.blockTimestamp });
      } catch (runtimeErr) {
        console.warn("[studio] failed to refresh proposal runtime metadata", runtimeErr);
      }
      setProposals(nextProposals);
      setDapps(nextDapps);
      setStatus(`Loaded ${nextProposals.length} proposals and ${nextDapps.length} dapps`);
      return { proposals: nextProposals, dapps: nextDapps };
    } catch (err) {
      reportError(err, "Failed to refresh governance data");
      return null;
    }
  }

  async function waitForProposalToAppear(expectedProposalId: bigint | null): Promise<boolean> {
    for (let attempt = 1; attempt <= PROPOSAL_INDEX_RETRY_COUNT; attempt += 1) {
      const data = await refreshGovernanceData();
      if (!expectedProposalId) {
        return data !== null;
      }
      if (data?.proposals.some((proposal) => proposal.proposalId === expectedProposalId)) {
        return true;
      }
      if (attempt < PROPOSAL_INDEX_RETRY_COUNT) {
        setStatus(
          `Waiting for proposal #${expectedProposalId.toString()} to index (${attempt}/${PROPOSAL_INDEX_RETRY_COUNT})...`
        );
        await new Promise((resolve) => window.setTimeout(resolve, PROPOSAL_INDEX_RETRY_DELAY_MS));
      }
    }
    return false;
  }

  useEffect(() => {
    if (!(publicClient && walletClient && account && network) || chainId === null) return;
    const key = `${account.toLowerCase()}-${chainId}`;
    if (lastAutoRefreshKeyRef.current === key) return;
    lastAutoRefreshKeyRef.current = key;
    void refreshGovernanceData();
  }, [publicClient, walletClient, account, network, chainId]);

  useEffect(() => {
    if (!(publicClient && walletClient && account && network) || chainId === null) return;
    const timer = window.setInterval(() => {
      void refreshGovernanceData();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [publicClient, walletClient, account, network, chainId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function onProposePublish() {
    setPublishSubmitting(true);
    try {
      const clients = await withClients();
      setPublishFeedback({ kind: "pending", message: "Checking proposer voting power..." });
      const eligibility = await getProposerEligibility(
        clients.publicClient,
        clients.network.vfiGovernor,
        clients.account
      );
      console.info("[studio] publish proposal eligibility", {
        governor: clients.network.vfiGovernor,
        account: clients.account,
        currentBlock: eligibility.currentBlock.toString(),
        snapshotBlock: eligibility.snapshotBlock.toString(),
        votes: eligibility.votes.toString(),
        threshold: eligibility.threshold.toString(),
        eligible: eligibility.eligible,
      });

      if (!eligibility.eligible) {
        throw new Error(
          `Insufficient proposer voting power at block ${eligibility.snapshotBlock.toString()}: ` +
          `have ${eligibility.votes.toString()}, need ${eligibility.threshold.toString()}. ` +
          "Delegate voting power to your proposer wallet and try again."
        );
      }

      setStatus("Submitting publish proposal...");
      setPublishFeedback({ kind: "pending", message: "Please confirm the transaction in your wallet..." });
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
      setStatus("Publish proposal submitted; waiting for confirmation...");
      setPublishFeedback({ kind: "pending", message: `Transaction submitted: ${shortHash(hash)}. Waiting for confirmation...` });
      const proposalId = await waitForProposalCreated(
        clients.publicClient,
        clients.network.vfiGovernor,
        hash
      );
      setPublishFeedback({
        kind: "pending",
        message: proposalId
          ? `Confirmed on-chain. Waiting for proposal #${proposalId.toString()} to appear...`
          : "Confirmed on-chain. Waiting for proposal list to refresh...",
      });
      console.info("[studio] publish proposal submitted", { txHash: hash });
      const appeared = await waitForProposalToAppear(proposalId);
      if (!appeared) {
        pushToast("Proposal transaction confirmed, but indexing is delayed. Please refresh shortly.", "info");
      }
      setPublishRootCid("");
      setPublishName("");
      setPublishVersion("");
      setPublishDescription("");
      setPublishProposalDescription("");
      setPublishFeedback({
        kind: "success",
        message: proposalId
          ? `Publish proposal #${proposalId.toString()} is now visible.`
          : "Publish proposal confirmed.",
      });
      setStudioPage("proposals");
    } catch (err) {
      const message = extractErrorMessage(err, "Failed to submit publish proposal");
      setPublishFeedback({ kind: "error", message });
      reportError(err, "Failed to submit publish proposal");
    } finally {
      setPublishSubmitting(false);
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
      setStatus("Upgrade proposal submitted; waiting for confirmation...");
      const proposalId = await waitForProposalCreated(
        clients.publicClient,
        clients.network.vfiGovernor,
        hash
      );
      const appeared = await waitForProposalToAppear(proposalId);
      if (!appeared) {
        pushToast("Proposal transaction confirmed, but indexing is delayed. Please refresh shortly.", "info");
      }
      setUpgradeDappId("");
      setUpgradeRootCid("");
      setUpgradeName("");
      setUpgradeVersion("");
      setUpgradeDescription("");
      setUpgradeProposalDescription("");
      setStudioPage("proposals");
    } catch (err) {
      reportError(err, "Failed to submit upgrade proposal");
    }
  }

  async function onCastVote(proposalId: bigint) {
    setGovernanceActionPending(proposalId, "vote");
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
      setStatus("Vote submitted; waiting for confirmation...");
      await (clients.publicClient as any).waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120_000,
      });
      pushToast(`Vote confirmed: ${shortHash(hash)}`, "success");
      setStatus("Vote confirmed");
      await refreshGovernanceData();
    } catch (err) {
      reportError(err, "Failed to cast vote");
    } finally {
      setGovernanceActionPending(proposalId, null);
    }
  }

  async function onQueue(proposal: ProposalInfo) {
    setGovernanceActionPending(proposal.proposalId, "queue");
    try {
      const clients = await withClients();
      setStatus(`Queueing proposal #${proposal.proposalId.toString()}...`);
      const hash = await queueProposal(clients.walletClient, clients.network.vfiGovernor, clients.account, proposal);
      setTxHash(hash);
      setStatus("Queue submitted; waiting for confirmation...");
      await (clients.publicClient as any).waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120_000,
      });
      pushToast(`Queue confirmed: ${shortHash(hash)}`, "success");
      setStatus("Queue confirmed");
      await refreshGovernanceData();
    } catch (err) {
      reportError(err, "Failed to queue proposal");
    } finally {
      setGovernanceActionPending(proposal.proposalId, null);
    }
  }

  async function onExecute(proposal: ProposalInfo) {
    setGovernanceActionPending(proposal.proposalId, "execute");
    try {
      const clients = await withClients();
      setStatus(`Executing proposal #${proposal.proposalId.toString()}...`);
      const hash = await executeProposal(clients.walletClient, clients.network.vfiGovernor, clients.account, proposal);
      setTxHash(hash);
      setStatus("Execute submitted; waiting for confirmation...");
      await (clients.publicClient as any).waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 120_000,
      });
      pushToast(`Execute confirmed: ${shortHash(hash)}`, "success");
      setStatus("Execute confirmed");
      await refreshGovernanceData();
    } catch (err) {
      reportError(err, "Failed to execute proposal");
    } finally {
      setGovernanceActionPending(proposal.proposalId, null);
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
      pushToast(message, "info");
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

  function onPublishChange(field: PublishFormField, value: string) {
    if (publishFeedback?.kind === "error") {
      setPublishFeedback(null);
    }
    switch (field) {
      case "rootCid":
        setPublishRootCid(value);
        break;
      case "name":
        setPublishName(value);
        break;
      case "version":
        setPublishVersion(value);
        break;
      case "description":
        setPublishDescription(value);
        break;
      case "proposalDescription":
        setPublishProposalDescription(value);
        break;
    }
  }

  function onUpgradeChange(field: UpgradeFormField, value: string) {
    switch (field) {
      case "dappId":
        setUpgradeDappId(value);
        break;
      case "rootCid":
        setUpgradeRootCid(value);
        break;
      case "name":
        setUpgradeName(value);
        break;
      case "version":
        setUpgradeVersion(value);
        break;
      case "description":
        setUpgradeDescription(value);
        break;
      case "proposalDescription":
        setUpgradeProposalDescription(value);
        break;
    }
  }

  const canAct = !!(publicClient && walletClient && account && network);
  const getLiveProposalState = useCallback(
    (proposal: ProposalInfo) =>
      proposalRuntimeById[proposal.proposalId.toString()]?.state ?? proposal.state,
    [proposalRuntimeById]
  );
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
      return proposals.filter((proposal) => HISTORICAL_STATES.has(getLiveProposalState(proposal)));
    }
    return proposals.filter((proposal) => !HISTORICAL_STATES.has(getLiveProposalState(proposal)));
  }, [proposals, proposalView, getLiveProposalState]);
  const proposalRows = useMemo<ProposalWithBundle[]>(() => {
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
      const state = getLiveProposalState(item);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return counts;
  }, [proposals, getLiveProposalState]);
  const queuedActions = useMemo(
    () =>
      proposalRows.filter(({ proposal }) =>
        (() => {
          const state = getLiveProposalState(proposal);
          return state === "Active" || state === "Succeeded" || state === "Queued";
        })()
      ),
    [proposalRows, getLiveProposalState]
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
          <DashboardPage
            proposalsCount={proposals.length}
            activeCount={proposalStateCounts.get("Active") ?? 0}
            readyToQueueCount={proposalStateCounts.get("Succeeded") ?? 0}
            queuedCount={proposalStateCounts.get("Queued") ?? 0}
            executedCount={proposalStateCounts.get("Executed") ?? 0}
            dappsCount={dapps.length}
            queuedActions={queuedActions}
            proposalRuntimeById={proposalRuntimeById}
            chainHead={chainHead}
            pendingGovernanceActionByProposalId={pendingGovernanceActionByProposalId}
            recentDapps={recentDapps}
            canAct={canAct}
            reviewLoading={reviewLoading}
            onReviewProposalBundle={onReviewProposalBundle}
            onCastVote={onCastVote}
            onQueue={onQueue}
            onExecute={onExecute}
          />
        ) : null}

        {studioPage === "actions" ? (
          <ActionsPage
            publishForm={{
              rootCid: publishRootCid,
              name: publishName,
              version: publishVersion,
              description: publishDescription,
              proposalDescription: publishProposalDescription,
            }}
            upgradeForm={{
              dappId: upgradeDappId,
              rootCid: upgradeRootCid,
              name: upgradeName,
              version: upgradeVersion,
              description: upgradeDescription,
              proposalDescription: upgradeProposalDescription,
            }}
            canAct={canAct}
            publishSubmitting={publishSubmitting}
            publishFeedback={publishFeedback}
            reviewLoading={reviewLoading}
            queuedActions={queuedActions}
            proposalRuntimeById={proposalRuntimeById}
            chainHead={chainHead}
            pendingGovernanceActionByProposalId={pendingGovernanceActionByProposalId}
            onPublishChange={onPublishChange}
            onUpgradeChange={onUpgradeChange}
            onProposePublish={onProposePublish}
            onProposeUpgrade={onProposeUpgrade}
            onReviewProposalBundle={onReviewProposalBundle}
            onCastVote={onCastVote}
            onQueue={onQueue}
            onExecute={onExecute}
          />
        ) : null}

        {studioPage === "proposals" ? (
          <ProposalsPage
            proposalView={proposalView}
            voteSupport={voteSupport}
            voteReason={voteReason}
            proposalRows={proposalRows}
            proposalRuntimeById={proposalRuntimeById}
            chainHead={chainHead}
            pendingGovernanceActionByProposalId={pendingGovernanceActionByProposalId}
            dapps={dapps}
            canAct={canAct}
            reviewLoading={reviewLoading}
            onProposalViewChange={setProposalView}
            onVoteSupportChange={setVoteSupport}
            onVoteReasonChange={setVoteReason}
            onReviewProposalBundle={onReviewProposalBundle}
            onCastVote={onCastVote}
            onQueue={onQueue}
            onExecute={onExecute}
          />
        ) : null}

        {studioPage === "review" ? (
          <ReviewPage
            reviewWorkspacePage={reviewWorkspacePage}
            reviewCid={reviewCid}
            reviewLoading={reviewLoading}
            reviewProgressPercent={reviewProgressPercent}
            reviewProgressMessage={reviewProgressMessage}
            reviewProgressIpcId={reviewProgressIpcId}
            reviewFiles={reviewFiles}
            reviewCodeFileCount={reviewCodeFileCount}
            filteredReviewFiles={filteredReviewFiles}
            reviewQuery={reviewQuery}
            selectedReviewPath={selectedReviewPath}
            selectedReviewHead={selectedReviewHead}
            selectedReviewSnippet={selectedReviewSnippet}
            renderedSnippet={renderedSnippet}
            onReviewWorkspacePageChange={setReviewWorkspacePage}
            onReviewCidChange={updateReviewCid}
            onLoadReviewBundle={onLoadReviewBundle}
            onReviewQueryChange={setReviewQuery}
            onReviewPathChange={setSelectedReviewPath}
            onOpenReviewFile={onOpenReviewFile}
            onOpenTypedReviewPath={onOpenTypedReviewPath}
          />
        ) : null}
        {toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
      </main>
    </div>
  );
}
