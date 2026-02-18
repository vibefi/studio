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
  topic0: Hex
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
        topics: [topic0],
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
      }],
    }) as Array<{ data: Hex; topics: Hex[] }>;
    logs.push(...chunk);
    start = end + 1n;
  }
  return logs;
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
