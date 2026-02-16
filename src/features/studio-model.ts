import { decodeFunctionData, formatEther, hexToString, isHex, toBytes, type Address, type Hex } from "viem";
import addressesJson from "../../addresses.json";
import dappRegistryAbi from "../../abis/DappRegistry.json";
import type { ProposalInfo } from "../eth/governor";
import type { IpfsListFile } from "../ipfs/client";

export type NetworkAddresses = {
  name?: string;
  deployBlock?: number;
  vfiGovernor: Address;
  dappRegistry: Address;
  vfiToken?: Address;
};

export type AddressesMap = Record<string, NetworkAddresses>;

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
  Array.from(new Set([...Object.keys(DEFAULT_NETWORKS), ...Object.keys(ADDRESSES)])).map(
    (chainKey) => [
      chainKey,
      {
        ...(DEFAULT_NETWORKS[chainKey] ?? {}),
        ...(ADDRESSES[chainKey] ?? {}),
      },
    ]
  )
) as AddressesMap;

const SUPPORTED_CHAIN_IDS = Object.keys(RESOLVED_ADDRESSES)
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isFinite(value));

export const DEFAULT_CHAIN_ID = SUPPORTED_CHAIN_IDS[0] ?? 11155111;
export const HISTORICAL_STATES = new Set(["Canceled", "Defeated", "Expired", "Executed"]);

export type ReviewFile = IpfsListFile & {
  isCode: boolean;
};

export type ProposalBundleRef = {
  action: "publishDapp" | "upgradeDapp";
  rootCid: string;
  dappId?: bigint;
};

export type ProposalWithBundle = {
  proposal: ProposalInfo;
  bundleRef: ProposalBundleRef | null;
};

export type StudioPage = "dashboard" | "proposals" | "actions" | "review";
export type ReviewWorkspacePage = "summary" | "explorer";

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

export function getNetwork(chainId: number | null): NetworkAddresses | null {
  if (!chainId) return null;
  return RESOLVED_ADDRESSES[String(chainId)] ?? null;
}

export function blockFrom(network: NetworkAddresses | null): bigint {
  return BigInt(network?.deployBlock ?? 0);
}

export function parseDappId(value: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("dapp id is required");
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("dapp id must be an unsigned integer");
  }
  return BigInt(trimmed);
}

export function proposalStateClass(state: string): string {
  if (state === "Succeeded" || state === "Executed") return "state-good";
  if (state === "Queued" || state === "Active" || state === "Pending") return "state-live";
  if (state === "Defeated" || state === "Canceled" || state === "Expired") return "state-bad";
  return "state-neutral";
}

function extensionFor(path: string): string {
  const trimmed = path.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === trimmed.length - 1) return "";
  return trimmed.slice(dotIndex + 1).toLowerCase();
}

export function isLikelyCodeFile(path: string): boolean {
  const ext = extensionFor(path);
  return CODE_EXTENSIONS.has(ext);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  return `${(kb / 1024).toFixed(2)} MiB`;
}

export function clampProgressPercent(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function formatProposalIdCompact(proposalId: bigint): string {
  const raw = proposalId.toString();
  if (raw.length <= 12) return `#${raw}`;
  return `#${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

export function formatEthBalance(value: bigint | null): string {
  if (value === null) return "--";
  const raw = Number.parseFloat(formatEther(value));
  if (!Number.isFinite(raw)) return formatEther(value);
  if (raw >= 1) return raw.toFixed(4);
  if (raw >= 0.0001) return raw.toFixed(6);
  return raw.toExponential(2);
}

export function withLineNumbers(text: string, startLine: number): string {
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

export function extractProposalBundleRef(
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
