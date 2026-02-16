type IpfsRequestArgs = {
  method: string;
  params?: unknown[];
};

type IpfsProgressHandler = (payload: unknown) => void;

export type IpfsProgressEvent = {
  ipcId: number;
  method?: string;
  phase?: string;
  percent?: number;
  message?: string;
  cid?: string;
  path?: string;
};

export type IpfsRequestOptions = {
  onProgress?: (event: IpfsProgressEvent) => void;
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

type IpfsRequestProvider = {
  request: (args: IpfsRequestArgs) => Promise<unknown>;
};

type IpfsProgressProvider = IpfsRequestProvider & {
  requestWithId: (args: IpfsRequestArgs) => { ipcId: number; response: Promise<unknown> };
  on: (event: "progress", handler: IpfsProgressHandler) => void;
  off: (event: "progress", handler: IpfsProgressHandler) => void;
};

declare global {
  interface Window {
    vibefiIpfs?: Partial<IpfsProgressProvider>;
  }
}

function baseProvider(): IpfsRequestProvider {
  const provider = window.vibefiIpfs;
  if (!provider?.request) {
    throw new Error("No injected IPFS provider found");
  }
  return provider as IpfsRequestProvider;
}

function progressProvider(): IpfsProgressProvider | null {
  const provider = window.vibefiIpfs;
  if (!provider?.request || !provider.requestWithId || !provider.on || !provider.off) {
    return null;
  }
  return provider as IpfsProgressProvider;
}

function normalizeProgressPayload(payload: unknown): IpfsProgressEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.ipcId !== "number") return null;
  return {
    ipcId: candidate.ipcId,
    method: typeof candidate.method === "string" ? candidate.method : undefined,
    phase: typeof candidate.phase === "string" ? candidate.phase : undefined,
    percent: typeof candidate.percent === "number" ? candidate.percent : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    cid: typeof candidate.cid === "string" ? candidate.cid : undefined,
    path: typeof candidate.path === "string" ? candidate.path : undefined,
  };
}

async function requestIpfs<T>(args: IpfsRequestArgs, options?: IpfsRequestOptions): Promise<T> {
  const onProgress = options?.onProgress;
  const trackedProvider = onProgress ? progressProvider() : null;
  if (!onProgress || !trackedProvider) {
    return (await baseProvider().request(args)) as T;
  }

  const { ipcId, response } = trackedProvider.requestWithId(args);
  const handler: IpfsProgressHandler = (payload) => {
    const progress = normalizeProgressPayload(payload);
    if (!progress || progress.ipcId !== ipcId) return;
    onProgress(progress);
  };

  trackedProvider.on("progress", handler);
  onProgress({ ipcId, phase: "queued", percent: 0, message: "Request queued" });
  try {
    return (await response) as T;
  } finally {
    trackedProvider.off("progress", handler);
  }
}

export async function ipfsList(cid: string, path = "", options?: IpfsRequestOptions) {
  return await requestIpfs<IpfsListResult>(
    {
      method: "vibefi_ipfsList",
      params: [cid, path],
    },
    options
  );
}

export async function ipfsHead(cid: string, path = "", options?: IpfsRequestOptions) {
  return await requestIpfs<IpfsHeadResult>(
    {
      method: "vibefi_ipfsHead",
      params: [cid, path],
    },
    options
  );
}

export async function ipfsReadSnippet(
  cid: string,
  path: string,
  startLine = 1,
  maxLines = 200,
  endLine?: number,
  options?: IpfsRequestOptions
) {
  return await requestIpfs<IpfsSnippetResult>(
    {
      method: "vibefi_ipfsRead",
      params: [cid, path, { as: "snippet", startLine, maxLines, endLine }],
    },
    options
  );
}
