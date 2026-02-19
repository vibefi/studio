import {
  decodeEventLog,
  keccak256,
  parseAbiItem,
  stringToHex,
  toEventSelector,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import governorAbi from "../../abis/VfiGovernor.json";

export type ProposalInfo = {
  proposalId: bigint;
  proposer: Address;
  description: string;
  targets: Address[];
  values: bigint[];
  calldatas: Hex[];
  voteStart: bigint;
  voteEnd: bigint;
  state: string;
};

export type ProposerEligibility = {
  currentBlock: bigint;
  snapshotBlock: bigint;
  votes: bigint;
  threshold: bigint;
  eligible: boolean;
};

export type VoteDirection = "for" | "against" | "abstain";

export type ProposalRuntimeInfo = {
  proposalId: bigint;
  state: string;
  snapshotBlock: bigint;
  deadlineBlock: bigint;
  etaSeconds: bigint;
  hasVoted: boolean;
  voteDirection: VoteDirection | null;
  voteWeight: bigint | null;
};

export type ProposalRuntimeBundle = {
  blockNumber: bigint;
  blockTimestamp: bigint;
  byProposalId: Record<string, ProposalRuntimeInfo>;
};

const STATE_NAMES = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed"
] as const;

const DEFAULT_LOG_CHUNK_SIZE = 45_000n;
const PROPOSAL_CREATED_EVENT = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)"
);
const VOTE_CAST_EVENT = parseAbiItem(
  "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)"
);
const VOTE_CAST_WITH_PARAMS_EVENT = parseAbiItem(
  "event VoteCastWithParams(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason, bytes params)"
);

function argAt(args: unknown, key: string, index: number): unknown {
  if (args && typeof args === "object") {
    const rec = args as Record<string, unknown>;
    if (rec[key] !== undefined) return rec[key];
    if (rec[String(index)] !== undefined) return rec[String(index)];
  }
  return undefined;
}

async function getRawLogsChunkedByTopic(
  pc: any,
  address: Address,
  fromBlock: bigint,
  topic0: Hex,
  topicsRest: Array<Hex | null> = []
): Promise<Array<{ data: Hex; topics: Hex[]; blockNumber?: Hex; logIndex?: Hex }>> {
  const latestBlock = (await pc.getBlockNumber()) as bigint;
  if (fromBlock > latestBlock) return [];

  const logs: Array<{ data: Hex; topics: Hex[]; blockNumber?: Hex; logIndex?: Hex }> = [];
  for (let start = fromBlock; start <= latestBlock; ) {
    const end = start + DEFAULT_LOG_CHUNK_SIZE > latestBlock
      ? latestBlock
      : start + DEFAULT_LOG_CHUNK_SIZE;
    const chunk = await pc.request({
      method: "eth_getLogs",
      params: [{
        address,
        topics: [topic0, ...topicsRest],
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
      }],
    }) as Array<{ data: Hex; topics: Hex[] }>;
    logs.push(...chunk);
    start = end + 1n;
  }
  return logs;
}

function voteDirectionFromSupport(value: unknown): VoteDirection | null {
  const n = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : null;
  if (n === 0) return "against";
  if (n === 1) return "for";
  if (n === 2) return "abstain";
  return null;
}

function topicAddress(address: Address): Hex {
  return (`0x${address.toLowerCase().slice(2).padStart(64, "0")}`) as Hex;
}

type AccountVoteEvent = {
  proposalId: bigint;
  support: VoteDirection | null;
  weight: bigint;
  blockNumber: bigint;
  logIndex: bigint;
};

async function getAccountVoteEvents(
  pc: any,
  governor: Address,
  voter: Address,
  fromBlock: bigint
): Promise<Map<string, AccountVoteEvent>> {
  const voterTopic = topicAddress(voter);
  const [voteCastLogs, voteCastWithParamsLogs] = await Promise.all([
    getRawLogsChunkedByTopic(pc, governor, fromBlock, toEventSelector(VOTE_CAST_EVENT), [voterTopic]),
    getRawLogsChunkedByTopic(pc, governor, fromBlock, toEventSelector(VOTE_CAST_WITH_PARAMS_EVENT), [voterTopic]),
  ]);
  const out = new Map<string, AccountVoteEvent>();
  const all = [
    ...voteCastLogs.map((log) => ({ kind: "VoteCast" as const, log })),
    ...voteCastWithParamsLogs.map((log) => ({ kind: "VoteCastWithParams" as const, log })),
  ];
  for (const item of all) {
    try {
      const decoded = decodeEventLog({
        abi: [item.kind === "VoteCast" ? VOTE_CAST_EVENT : VOTE_CAST_WITH_PARAMS_EVENT],
        data: item.log.data,
        topics: item.log.topics as [Hex, ...Hex[]],
        strict: true,
      });
      const proposalId = argAt(decoded.args, "proposalId", 1);
      const support = argAt(decoded.args, "support", 2);
      const weight = argAt(decoded.args, "weight", 3);
      if (typeof proposalId !== "bigint") continue;
      if (typeof weight !== "bigint") continue;
      const event: AccountVoteEvent = {
        proposalId,
        support: voteDirectionFromSupport(support),
        weight,
        blockNumber: parseHexToBigint(item.log.blockNumber),
        logIndex: parseHexToBigint(item.log.logIndex),
      };
      const key = proposalId.toString();
      const prev = out.get(key);
      if (
        !prev ||
        event.blockNumber > prev.blockNumber ||
        (event.blockNumber === prev.blockNumber && event.logIndex > prev.logIndex)
      ) {
        out.set(key, event);
      }
    } catch {
      continue;
    }
  }
  return out;
}

function parseHexToBigint(value: unknown): bigint {
  if (typeof value !== "string" || !value.startsWith("0x")) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export async function listProposals(
  publicClient: PublicClient,
  governor: Address,
  fromBlock: bigint
): Promise<ProposalInfo[]> {
  const pc = publicClient as any;
  const topic0 = toEventSelector(PROPOSAL_CREATED_EVENT);
  const logs = await getRawLogsChunkedByTopic(pc, governor, fromBlock, topic0);

  const rowsRaw = await Promise.all(logs.map(async (log) => {
    try {
      const decoded = decodeEventLog({
        abi: [PROPOSAL_CREATED_EVENT],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: true,
      });
      const args = decoded.args;
      const proposalId = argAt(args, "proposalId", 0);
      const proposer = argAt(args, "proposer", 1);
      if (typeof proposalId !== "bigint" || typeof proposer !== "string") return null;

      const stateNum = await pc.readContract({
        address: governor,
        abi: governorAbi,
        functionName: "state",
        args: [proposalId]
      }) as bigint;

      return {
        proposalId,
        proposer: proposer as Address,
        description: (argAt(args, "description", 8) as string) ?? "",
        targets: (argAt(args, "targets", 2) as Address[]) ?? [],
        values: (argAt(args, "values", 3) as bigint[]) ?? [],
        calldatas: (argAt(args, "calldatas", 5) as Hex[]) ?? [],
        voteStart: (argAt(args, "voteStart", 6) as bigint) ?? 0n,
        voteEnd: (argAt(args, "voteEnd", 7) as bigint) ?? 0n,
        state: STATE_NAMES[Number(stateNum)] ?? String(stateNum),
        createdBlock: parseHexToBigint(log.blockNumber),
        createdLogIndex: parseHexToBigint(log.logIndex),
      } as ProposalInfo;
    } catch {
      return null;
    }
  }));
  const rows = rowsRaw.filter(
    (row): row is ProposalInfo & { createdBlock: bigint; createdLogIndex: bigint } => row !== null
  );

  rows.sort((a, b) => {
    if (a.createdBlock !== b.createdBlock) return a.createdBlock > b.createdBlock ? -1 : 1;
    if (a.createdLogIndex !== b.createdLogIndex) return a.createdLogIndex > b.createdLogIndex ? -1 : 1;
    if (a.voteStart !== b.voteStart) return a.voteStart > b.voteStart ? -1 : 1;
    if (a.proposalId !== b.proposalId) return a.proposalId > b.proposalId ? -1 : 1;
    return 0;
  });

  return rows.map(({ createdBlock: _createdBlock, createdLogIndex: _createdLogIndex, ...proposal }) => proposal);
}

export async function castVote(
  walletClient: WalletClient,
  governor: Address,
  account: Address,
  proposalId: bigint,
  support: "for" | "against" | "abstain",
  reason?: string
): Promise<Hex> {
  const supportMap: Record<"for" | "against" | "abstain", number> = {
    against: 0,
    for: 1,
    abstain: 2
  };
  const voteSupport = supportMap[support];

  if (reason && reason.trim().length > 0) {
    return (walletClient as any).writeContract({
      account,
      chain: undefined,
      address: governor,
      abi: governorAbi,
      functionName: "castVoteWithReason",
      args: [proposalId, voteSupport, reason]
    });
  }

  return (walletClient as any).writeContract({
    account,
    chain: undefined,
    address: governor,
    abi: governorAbi,
    functionName: "castVote",
    args: [proposalId, voteSupport]
  });
}

export async function queueProposal(
  walletClient: WalletClient,
  governor: Address,
  account: Address,
  proposal: Pick<ProposalInfo, "targets" | "values" | "calldatas" | "description">
): Promise<Hex> {
  const descriptionHash = keccak256(stringToHex(proposal.description));
  return (walletClient as any).writeContract({
    account,
    chain: undefined,
    address: governor,
    abi: governorAbi,
    functionName: "queue",
    args: [proposal.targets, proposal.values, proposal.calldatas, descriptionHash]
  });
}

export async function executeProposal(
  walletClient: WalletClient,
  governor: Address,
  account: Address,
  proposal: Pick<ProposalInfo, "targets" | "values" | "calldatas" | "description">
): Promise<Hex> {
  const descriptionHash = keccak256(stringToHex(proposal.description));
  return (walletClient as any).writeContract({
    account,
    chain: undefined,
    address: governor,
    abi: governorAbi,
    functionName: "execute",
    args: [proposal.targets, proposal.values, proposal.calldatas, descriptionHash]
  });
}

export async function getProposerEligibility(
  publicClient: PublicClient,
  governor: Address,
  account: Address
): Promise<ProposerEligibility> {
  const pc = publicClient as any;
  const currentBlock = (await pc.getBlockNumber()) as bigint;
  const snapshotBlock = currentBlock > 0n ? currentBlock - 1n : 0n;
  const [threshold, votes] = await Promise.all([
    pc.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "proposalThreshold",
      args: []
    }) as Promise<bigint>,
    pc.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "getVotes",
      args: [account, snapshotBlock]
    }) as Promise<bigint>,
  ]);

  return {
    currentBlock,
    snapshotBlock,
    votes,
    threshold,
    eligible: votes >= threshold,
  };
}

export async function waitForProposalCreated(
  publicClient: PublicClient,
  governor: Address,
  txHash: Hex,
  timeoutMs = 120_000
): Promise<bigint | null> {
  const pc = publicClient as any;
  const receipt = await pc.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: timeoutMs,
  });
  const status = (receipt as { status?: unknown }).status;
  const success = status === "success" || status === true || status === 1 || status === 1n;
  if (!success) {
    throw new Error(`Transaction ${txHash} failed or reverted (status=${String(status)})`);
  }

  const governorLower = governor.toLowerCase();
  const topic0 = toEventSelector(PROPOSAL_CREATED_EVENT).toLowerCase();
  for (const log of receipt.logs as Array<{ address?: string; topics?: Hex[]; data?: Hex }>) {
    if (!log.address || log.address.toLowerCase() !== governorLower) continue;
    if (!log.topics?.[0] || log.topics[0].toLowerCase() !== topic0) continue;
    try {
      const decoded = decodeEventLog({
        abi: [PROPOSAL_CREATED_EVENT],
        data: (log.data ?? "0x") as Hex,
        topics: log.topics as [Hex, ...Hex[]],
        strict: true,
      });
      const proposalId = argAt(decoded.args, "proposalId", 0);
      if (typeof proposalId === "bigint") return proposalId;
    } catch {
      continue;
    }
  }

  return null;
}

export async function loadProposalRuntimeData(
  publicClient: PublicClient,
  governor: Address,
  proposals: ProposalInfo[],
  account: Address | null,
  fromBlock: bigint
): Promise<ProposalRuntimeBundle> {
  const pc = publicClient as any;
  const blockNumber = (await pc.getBlockNumber()) as bigint;
  const block = await pc.getBlock({ blockNumber });
  const blockTimestamp = (block?.timestamp ?? 0n) as bigint;
  const accountVotes = account
    ? await getAccountVoteEvents(pc, governor, account, fromBlock)
    : new Map<string, AccountVoteEvent>();

  const entries = await Promise.all(
    proposals.map(async (proposal) => {
      const proposalId = proposal.proposalId;
      const fallback: ProposalRuntimeInfo = {
        proposalId,
        state: proposal.state,
        snapshotBlock: proposal.voteStart,
        deadlineBlock: proposal.voteEnd,
        etaSeconds: 0n,
        hasVoted: false,
        voteDirection: null,
        voteWeight: null,
      };
      try {
        const [stateNum, snapshotBlock, deadlineBlock, etaSeconds, hasVoted] = await Promise.all([
          pc.readContract({
            address: governor,
            abi: governorAbi,
            functionName: "state",
            args: [proposalId],
          }) as Promise<bigint>,
          pc.readContract({
            address: governor,
            abi: governorAbi,
            functionName: "proposalSnapshot",
            args: [proposalId],
          }) as Promise<bigint>,
          pc.readContract({
            address: governor,
            abi: governorAbi,
            functionName: "proposalDeadline",
            args: [proposalId],
          }) as Promise<bigint>,
          pc.readContract({
            address: governor,
            abi: governorAbi,
            functionName: "proposalEta",
            args: [proposalId],
          }) as Promise<bigint>,
          account
            ? (pc.readContract({
                address: governor,
                abi: governorAbi,
                functionName: "hasVoted",
                args: [proposalId, account],
              }) as Promise<boolean>)
            : Promise.resolve(false),
        ]);
        const key = proposalId.toString();
        const vote = accountVotes.get(key);
        return [
          key,
          {
            proposalId,
            state: STATE_NAMES[Number(stateNum)] ?? String(stateNum),
            snapshotBlock,
            deadlineBlock,
            etaSeconds,
            hasVoted,
            voteDirection: hasVoted ? vote?.support ?? null : null,
            voteWeight: hasVoted ? vote?.weight ?? null : null,
          } as ProposalRuntimeInfo,
        ] as const;
      } catch {
        return [proposalId.toString(), fallback] as const;
      }
    })
  );

  return {
    blockNumber,
    blockTimestamp,
    byProposalId: Object.fromEntries(entries),
  };
}
