import {
  bytesToHex,
  encodeFunctionData,
  hexToString,
  isHex,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import governorAbi from "../../abis/VfiGovernor.json";
import dappRegistryAbi from "../../abis/DappRegistry.json";

const MAX_ROOT_CID_BYTES = 4096;

export type DappRow = {
  dappId: bigint;
  versionId: bigint;
  name: string;
  version: string;
  description: string;
  status: string;
  rootCid: string;
};

export function encodeRootCid(input: string): Hex {
  const raw = input.trim();
  if (!raw) throw new Error("rootCid cannot be empty");
  if (isHex(raw)) {
    const bytes = toBytes(raw as Hex);
    if (bytes.length === 0) throw new Error("rootCid hex must not be empty");
    if (bytes.length > MAX_ROOT_CID_BYTES) throw new Error(`rootCid exceeds ${MAX_ROOT_CID_BYTES} bytes`);
    return raw as Hex;
  }
  const bytes = toBytes(raw);
  if (bytes.length > MAX_ROOT_CID_BYTES) throw new Error(`rootCid exceeds ${MAX_ROOT_CID_BYTES} bytes`);
  return bytesToHex(bytes);
}

export async function proposePublish(
  walletClient: WalletClient,
  governor: Address,
  dappRegistry: Address,
  account: Address,
  input: {
    rootCid: string;
    name: string;
    dappVersion: string;
    description: string;
    proposalDescription?: string;
  }
): Promise<Hex> {
  const calldata = encodeFunctionData({
    abi: dappRegistryAbi,
    functionName: "publishDapp",
    args: [encodeRootCid(input.rootCid), input.name, input.dappVersion, input.description]
  });

  const description = input.proposalDescription?.trim() || `Publish dapp ${input.name} ${input.dappVersion}`;

  return (walletClient as any).writeContract({
    account,
    chain: undefined,
    address: governor,
    abi: governorAbi,
    functionName: "propose",
    args: [[dappRegistry], [0n], [calldata], description]
  });
}

export async function proposeUpgrade(
  walletClient: WalletClient,
  governor: Address,
  dappRegistry: Address,
  account: Address,
  input: {
    dappId: bigint;
    rootCid: string;
    name: string;
    dappVersion: string;
    description: string;
    proposalDescription?: string;
  }
): Promise<Hex> {
  const calldata = encodeFunctionData({
    abi: dappRegistryAbi,
    functionName: "upgradeDapp",
    args: [input.dappId, encodeRootCid(input.rootCid), input.name, input.dappVersion, input.description]
  });

  const description = input.proposalDescription?.trim() || `Upgrade dapp #${input.dappId.toString()} ${input.name} ${input.dappVersion}`;

  return (walletClient as any).writeContract({
    account,
    chain: undefined,
    address: governor,
    abi: governorAbi,
    functionName: "propose",
    args: [[dappRegistry], [0n], [calldata], description]
  });
}

type Version = {
  versionId: bigint;
  rootCid?: string;
  name?: string;
  version?: string;
  description?: string;
  status?: string;
};

type Dapp = {
  dappId: bigint;
  latestVersionId: bigint;
  versions: Map<string, Version>;
};

function decodeCid(value?: Hex): string {
  if (!value) return "";
  try {
    return hexToString(value).replace(/\0+$/g, "");
  } catch {
    return value;
  }
}

export async function listDapps(
  publicClient: PublicClient,
  dappRegistry: Address,
  fromBlock: bigint
): Promise<DappRow[]> {
  const pc = publicClient as any;
  const [published, upgraded, metadata, paused, unpaused, deprecated] = await Promise.all([
    pc.getLogs({ address: dappRegistry, abi: dappRegistryAbi, eventName: "DappPublished", fromBlock, toBlock: "latest" }),
    pc.getLogs({ address: dappRegistry, abi: dappRegistryAbi, eventName: "DappUpgraded", fromBlock, toBlock: "latest" }),
    pc.getLogs({ address: dappRegistry, abi: dappRegistryAbi, eventName: "DappMetadata", fromBlock, toBlock: "latest" }),
    pc.getLogs({ address: dappRegistry, abi: dappRegistryAbi, eventName: "DappPaused", fromBlock, toBlock: "latest" }),
    pc.getLogs({ address: dappRegistry, abi: dappRegistryAbi, eventName: "DappUnpaused", fromBlock, toBlock: "latest" }),
    pc.getLogs({ address: dappRegistry, abi: dappRegistryAbi, eventName: "DappDeprecated", fromBlock, toBlock: "latest" })
  ]);

  const all = [...published, ...upgraded, ...metadata, ...paused, ...unpaused, ...deprecated].sort((a, b) => {
    const blockDiff = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
    if (blockDiff !== 0) return blockDiff;
    return Number((a.logIndex ?? 0n) - (b.logIndex ?? 0n));
  });

  const dapps = new Map<string, Dapp>();

  const getVersion = (dappId: bigint, versionId: bigint) => {
    const key = dappId.toString();
    const dapp = dapps.get(key) ?? { dappId, latestVersionId: 0n, versions: new Map() };
    const versionKey = versionId.toString();
    const version = dapp.versions.get(versionKey) ?? { versionId };
    dapp.versions.set(versionKey, version);
    dapps.set(key, dapp);
    return { dapp, version };
  };

  for (const log of all as any[]) {
    if (log.eventName === "DappPublished") {
      const dappId = log.args.dappId as bigint;
      const versionId = log.args.versionId as bigint;
      const { dapp, version } = getVersion(dappId, versionId);
      version.rootCid = decodeCid(log.args.rootCid as Hex);
      version.status = "Published";
      dapp.latestVersionId = versionId;
    } else if (log.eventName === "DappUpgraded") {
      const dappId = log.args.dappId as bigint;
      const versionId = log.args.toVersionId as bigint;
      const { dapp, version } = getVersion(dappId, versionId);
      version.rootCid = decodeCid(log.args.rootCid as Hex);
      version.status = "Published";
      dapp.latestVersionId = versionId;
    } else if (log.eventName === "DappMetadata") {
      const dappId = log.args.dappId as bigint;
      const versionId = log.args.versionId as bigint;
      const { version } = getVersion(dappId, versionId);
      version.name = (log.args.name as string) ?? "";
      version.version = (log.args.version as string) ?? "";
      version.description = (log.args.description as string) ?? "";
    } else if (log.eventName === "DappPaused") {
      const { version } = getVersion(log.args.dappId as bigint, log.args.versionId as bigint);
      version.status = "Paused";
    } else if (log.eventName === "DappUnpaused") {
      const { version } = getVersion(log.args.dappId as bigint, log.args.versionId as bigint);
      version.status = "Published";
    } else if (log.eventName === "DappDeprecated") {
      const { version } = getVersion(log.args.dappId as bigint, log.args.versionId as bigint);
      version.status = "Deprecated";
    }
  }

  return Array.from(dapps.values()).map((dapp) => {
    const latest = dapp.versions.get(dapp.latestVersionId.toString());
    return {
      dappId: dapp.dappId,
      versionId: dapp.latestVersionId,
      name: latest?.name ?? "",
      version: latest?.version ?? "",
      description: latest?.description ?? "",
      status: latest?.status ?? "Unknown",
      rootCid: latest?.rootCid ?? ""
    };
  });
}
