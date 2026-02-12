import { createPublicClient, createWalletClient, custom, defineChain, getAddress, http } from "viem";
import { requireRpcUrl } from "../env";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export function buildPublicClient(chainId: number) {
  const rpcUrl = requireRpcUrl();
  const chain = defineChain({
    id: chainId,
    name: chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] }
    }
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function connectWallet(): Promise<{ account: `0x${string}`; chainId: number }> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const accounts = await eth.request({ method: "eth_requestAccounts", params: [] }) as string[];
  const account = accounts?.[0];
  if (!account) throw new Error("No wallet account returned");

  const chainHex = await eth.request({ method: "eth_chainId", params: [] }) as string;
  const chainId = Number.parseInt(chainHex, 16);
  return { account: getAddress(account), chainId };
}

export async function buildWalletClient(chainId: number) {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const chain = defineChain({
    id: chainId,
    name: chainId === 11155111 ? "Sepolia" : `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [requireRpcUrl()] }
    }
  });
  return createWalletClient({ chain, transport: custom(eth) });
}
