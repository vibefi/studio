import { createPublicClient, createWalletClient, custom, defineChain, getAddress, http } from "viem";
import { getRpcUrl } from "../env";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};

function normalizeChainId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith("eip155:")) {
    const parsed = Number.parseInt(raw.slice("eip155:".length), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const parsed = Number.parseInt(raw, 16);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export function buildPublicClient(chainId: number) {
  const rpcUrl = getRpcUrl();
  const eth = window.ethereum;
  const chain = defineChain({
    id: chainId,
    name: chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: rpcUrl ? [rpcUrl] : [] }
    }
  });
  if (eth) {
    return createPublicClient({ chain, transport: custom(eth) });
  }
  return createPublicClient({ chain, transport: rpcUrl ? http(rpcUrl) : http() });
}

export async function getConnectedAccount(): Promise<`0x${string}` | null> {
  const eth = window.ethereum;
  if (!eth) return null;
  const accounts = await eth.request({ method: "eth_accounts" }) as string[];
  const account = accounts?.[0];
  return account ? getAddress(account) : null;
}

export async function getChainId(): Promise<number | null> {
  const eth = window.ethereum;
  if (!eth) return null;
  const value = await eth.request({ method: "eth_chainId" });
  return normalizeChainId(value);
}

export async function connectWallet(): Promise<{ account: `0x${string}`; chainId: number }> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
  const account = accounts?.[0];
  if (!account) throw new Error("No wallet account returned");

  const chainValue = await eth.request({ method: "eth_chainId" });
  const chainId = normalizeChainId(chainValue);
  if (chainId === null) throw new Error(`Unsupported eth_chainId response: ${String(chainValue)}`);
  return { account: getAddress(account), chainId };
}

export async function switchToChain(chainId: number): Promise<void> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  await eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  });
}

export async function buildWalletClient(chainId: number) {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const rpcUrl = getRpcUrl();
  const chain = defineChain({
    id: chainId,
    name: chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: rpcUrl ? [rpcUrl] : [] }
    }
  });
  return createWalletClient({ chain, transport: custom(eth) });
}
