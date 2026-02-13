type IpfsRequestArgs = {
  method: string;
  params?: unknown[];
};

export type IpfsListFile = {
  path: string;
  bytes: number;
};

export type IpfsListResult = {
  cid: string;
  path: string;
  files: IpfsListFile[];
};

export type IpfsHeadResult = {
  cid: string;
  path: string;
  size: number;
  contentType?: string;
};

export type IpfsSnippetResult = {
  kind: "snippet";
  cid: string;
  path: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  truncatedHead: boolean;
  truncatedTail: boolean;
  hasBidiControls: boolean;
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
  return (await provider().request({
    method: "vibefi_ipfsList",
    params: [cid, path],
  })) as IpfsListResult;
}

export async function ipfsHead(cid: string, path = "") {
  return (await provider().request({
    method: "vibefi_ipfsHead",
    params: [cid, path],
  })) as IpfsHeadResult;
}

export async function ipfsReadSnippet(
  cid: string,
  path: string,
  startLine = 1,
  maxLines = 200,
  endLine?: number
) {
  return (await provider().request({
    method: "vibefi_ipfsRead",
    params: [cid, path, { as: "snippet", startLine, maxLines, endLine }],
  })) as IpfsSnippetResult;
}
