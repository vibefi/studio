type IpfsRequestArgs = {
  method: string;
  params?: unknown[];
};

declare global {
  interface Window {
    vibefiIpfs?: {
      request: (args: IpfsRequestArgs) => Promise<unknown>;
    };
  }
}

function provider() {
  const ipfs = window.vibefiIpfs;
  if (!ipfs?.request) {
    throw new Error("No injected vibefiIpfs provider found");
  }
  return ipfs;
}

export async function ipfsList(cid: string, path = "") {
  return provider().request({ method: "vibefi_ipfsList", params: [cid, path] });
}

export async function ipfsHead(cid: string, path = "") {
  return provider().request({ method: "vibefi_ipfsHead", params: [cid, path] });
}

export async function ipfsReadSnippet(cid: string, path: string, startLine = 1, maxLines = 200) {
  return provider().request({
    method: "vibefi_ipfsRead",
    params: [cid, path, { as: "snippet", startLine, maxLines }]
  });
}
