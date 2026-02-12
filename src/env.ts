export function getRpcUrl(): string | undefined {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.RPC_URL ?? env.VITE_RPC_URL;
}

export function requireRpcUrl(): string {
  const rpc = getRpcUrl();
  if (!rpc) {
    throw new Error("Missing RPC_URL or VITE_RPC_URL");
  }
  return rpc;
}

export function shortHash(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
