import {
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient
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

export async function listProposals(
  publicClient: PublicClient,
  governor: Address,
  fromBlock: bigint
): Promise<ProposalInfo[]> {
  const pc = publicClient as any;
  const logs = await pc.getLogs({
    address: governor,
    abi: governorAbi,
    eventName: "ProposalCreated",
    fromBlock,
    toBlock: "latest"
  });

  const rows = await Promise.all(logs.map(async (log: any) => {
    const args = log.args as Record<string, unknown>;
    const proposalId = args.proposalId as bigint;
    const stateNum = await pc.readContract({
      address: governor,
      abi: governorAbi,
      functionName: "state",
      args: [proposalId]
    }) as bigint;

    return {
      proposalId,
      proposer: args.proposer as Address,
      description: args.description as string,
      targets: (args.targets as Address[]) ?? [],
      values: (args.values as bigint[]) ?? [],
      calldatas: (args.calldatas as Hex[]) ?? [],
      voteStart: args.voteStart as bigint,
      voteEnd: args.voteEnd as bigint,
      state: STATE_NAMES[Number(stateNum)] ?? String(stateNum)
    };
  }));

  rows.sort((a, b) => Number(b.proposalId - a.proposalId));
  return rows;
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
