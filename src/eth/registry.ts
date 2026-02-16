import {
  bytesToHex,
  decodeEventLog,
  encodeFunctionData,
  hexToString,
  isHex,
  parseAbiItem,
  toEventSelector,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import governorAbi from "../../abis/VfiGovernor.json";
import dappRegistryAbi from "../../abis/DappRegistry.json";

const MAX_ROOT_CID_BYTES = 4096;
const DEFAULT_LOG_CHUNK_SIZE = 45_000n;
const DAPP_PUBLISHED_EVENT = parseAbiItem(
  "event DappPublished(uint256 indexed dappId, uint256 indexed versionId, bytes rootCid, address proposer)"
);
const DAPP_UPGRADED_EVENT = parseAbiItem(
  "event DappUpgraded(uint256 indexed dappId, uint256 indexed fromVersionId, uint256 indexed toVersionId, bytes rootCid, address proposer)"
);
const DAPP_METADATA_EVENT = parseAbiItem(
  "event DappMetadata(uint256 indexed dappId, uint256 indexed versionId, string name, string version, string description)"
);
const DAPP_PAUSED_EVENT = parseAbiItem(
  "event DappPaused(uint256 indexed dappId, uint256 indexed versionId, address pausedBy, string reason)"
);
const DAPP_UNPAUSED_EVENT = parseAbiItem(
  "event DappUnpaused(uint256 indexed dappId, uint256 indexed versionId, address unpausedBy, string reason)"
);
const DAPP_DEPRECATED_EVENT = parseAbiItem(
  "event DappDeprecated(uint256 indexed dappId, uint256 indexed versionId, address deprecatedBy, string reason)"
);

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

function asBigIntQuantity(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") {
    if (value.startsWith("0x") || value.startsWith("0X")) return BigInt(value);
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return BigInt(n);
  }
  return 0n;
}

function decodeCid(value?: Hex): string {
  if (!value) return "";
  try {
    return hexToString(value).replace(/\0+$/g, "");
  } catch {
    return value;
  }
}

async function getLogsChunked(pc: any, params: {
  address: Address;
  topic0: Hex;
  fromBlock: bigint;
}): Promise<any[]> {
  const latestBlock = (await pc.getBlockNumber()) as bigint;
  if (params.fromBlock > latestBlock) return [];

  const logs: any[] = [];
  for (let start = params.fromBlock; start <= latestBlock; ) {
    const end = start + DEFAULT_LOG_CHUNK_SIZE > latestBlock
      ? latestBlock
      : start + DEFAULT_LOG_CHUNK_SIZE;
    const chunk = await pc.request({
      method: "eth_getLogs",
      params: [{
      address: params.address,
      topics: [params.topic0],
      fromBlock: `0x${start.toString(16)}`,
      toBlock: `0x${end.toString(16)}`,
      }],
    }) as any[];
    logs.push(...chunk);
    start = end + 1n;
  }
  return logs;
}

export async function listDapps(
  publicClient: PublicClient,
  dappRegistry: Address,
  fromBlock: bigint
): Promise<DappRow[]> {
  const pc = publicClient as any;
  const [published, upgraded, metadata, paused, unpaused, deprecated] = await Promise.all([
    getLogsChunked(pc, { address: dappRegistry, topic0: toEventSelector(DAPP_PUBLISHED_EVENT), fromBlock }),
    getLogsChunked(pc, { address: dappRegistry, topic0: toEventSelector(DAPP_UPGRADED_EVENT), fromBlock }),
    getLogsChunked(pc, { address: dappRegistry, topic0: toEventSelector(DAPP_METADATA_EVENT), fromBlock }),
    getLogsChunked(pc, { address: dappRegistry, topic0: toEventSelector(DAPP_PAUSED_EVENT), fromBlock }),
    getLogsChunked(pc, { address: dappRegistry, topic0: toEventSelector(DAPP_UNPAUSED_EVENT), fromBlock }),
    getLogsChunked(pc, { address: dappRegistry, topic0: toEventSelector(DAPP_DEPRECATED_EVENT), fromBlock })
  ]);

  const all = [
    ...published.map((log) => ({ kind: "DappPublished" as const, log })),
    ...upgraded.map((log) => ({ kind: "DappUpgraded" as const, log })),
    ...metadata.map((log) => ({ kind: "DappMetadata" as const, log })),
    ...paused.map((log) => ({ kind: "DappPaused" as const, log })),
    ...unpaused.map((log) => ({ kind: "DappUnpaused" as const, log })),
    ...deprecated.map((log) => ({ kind: "DappDeprecated" as const, log })),
  ].sort((a, b) => {
    const blockDiff = Number(
      asBigIntQuantity(a.log.blockNumber) - asBigIntQuantity(b.log.blockNumber)
    );
    if (blockDiff !== 0) return blockDiff;
    return Number(asBigIntQuantity(a.log.logIndex) - asBigIntQuantity(b.log.logIndex));
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

  for (const entry of all as any[]) {
    const log = entry.log;
    if (entry.kind === "DappPublished") {
      const decoded = decodeEventLog({
        abi: [DAPP_PUBLISHED_EVENT],
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as any;
      const dappId = args.dappId as bigint;
      const versionId = args.versionId as bigint;
      const { dapp, version } = getVersion(dappId, versionId);
      version.rootCid = decodeCid(args.rootCid as Hex);
      version.status = "Published";
      dapp.latestVersionId = versionId;
    } else if (entry.kind === "DappUpgraded") {
      const decoded = decodeEventLog({
        abi: [DAPP_UPGRADED_EVENT],
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as any;
      const dappId = args.dappId as bigint;
      const versionId = args.toVersionId as bigint;
      const { dapp, version } = getVersion(dappId, versionId);
      version.rootCid = decodeCid(args.rootCid as Hex);
      version.status = "Published";
      dapp.latestVersionId = versionId;
    } else if (entry.kind === "DappMetadata") {
      const decoded = decodeEventLog({
        abi: [DAPP_METADATA_EVENT],
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as any;
      const dappId = args.dappId as bigint;
      const versionId = args.versionId as bigint;
      const { version } = getVersion(dappId, versionId);
      version.name = (args.name as string) ?? "";
      version.version = (args.version as string) ?? "";
      version.description = (args.description as string) ?? "";
    } else if (entry.kind === "DappPaused") {
      const decoded = decodeEventLog({
        abi: [DAPP_PAUSED_EVENT],
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as any;
      const { version } = getVersion(args.dappId as bigint, args.versionId as bigint);
      version.status = "Paused";
    } else if (entry.kind === "DappUnpaused") {
      const decoded = decodeEventLog({
        abi: [DAPP_UNPAUSED_EVENT],
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as any;
      const { version } = getVersion(args.dappId as bigint, args.versionId as bigint);
      version.status = "Published";
    } else if (entry.kind === "DappDeprecated") {
      const decoded = decodeEventLog({
        abi: [DAPP_DEPRECATED_EVENT],
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const args = decoded.args as any;
      const { version } = getVersion(args.dappId as bigint, args.versionId as bigint);
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
