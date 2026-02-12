# VibeFi Studio vapp Plan (Sepolia Steps 4-7)

## 1. Goal
Build `studio` as a VibeFi-compatible vapp that is the primary governance entrypoint for the VibeFi DAO and can execute the Sepolia deployment flow steps 4-7 from `contracts/README.md`:
1. Propose dapp publish/upgrade.
2. Vote on proposals.
3. Queue successful proposals.
4. Execute queued proposals.
5. Verify resulting dapp state from registry events.

## 2. Inputs Reviewed
1. `contracts/README.md` (especially "Sepolia Testnet Deployment" steps 4-7).
2. `dapp-examples/constraints.md`.
3. `dapp-examples/README.md`.
4. CLI behavior in `cli/src/commands/dapp.ts`, `cli/src/commands/vote.ts`, `cli/src/commands/proposals.ts`, `cli/src/commands/registry.ts`, `cli/src/commands/governor.ts`.
5. Client runtime injection/CSP model in `client/README.md`, `client/internal-ui/src/preload-app.ts`, and `client/src/registry.rs`.

## 3. Hard Constraints (Current)
1. Must remain a VibeFi vapp-compatible frontend (React/Vite + approved package set).
2. Must use injected wallet (`window.ethereum`) for writes.
3. Must use injected RPC (`RPC_URL`/`VITE_RPC_URL`) for reads.
4. Must avoid arbitrary outbound HTTP calls under current constraints/CSP expectations.
5. Must ship within constrained artifact layout (`src`, `abis`, `assets`, `addresses.json`, `manifest.json`, `index.html`).

## 4. Product Scope for Studio MVP
1. Governance dashboard for VFI DAO operations around dapp publication lifecycle.
2. End-to-end execution of Sepolia steps 4-7:
   - `dapp:propose`
   - `proposals:list` / proposal discovery
   - `vote:cast`
   - `proposals:queue`
   - `proposals:execute`
   - `dapp:list`-style verification
3. Read-only visibility into proposal state, vote totals, and dapp registry state.
4. Chain/network guardrails (must be on expected chain before signing).

## 5. Functional Flows (Mapped to Sepolia Steps)
### 5.1 Step 4: Propose dapp publish/upgrade
1. User enters `rootCid`, `name`, `dappVersion`, `description`, and optional proposal description.
2. App encodes calldata for `DappRegistry.publishDapp(...)` (and later `upgradeDapp(...)` support).
3. App calls `VfiGovernor.propose([dappRegistry], [0], [calldata], description)` via wallet.
4. UI stores/display submitted tx hash and optimistic pending state.

### 5.2 Step 5: Vote
1. App lists proposals from `ProposalCreated` logs.
2. For selected proposal, app loads:
   - governor state
   - snapshot/deadline
   - vote totals and quorum
3. User casts vote (`for|against|abstain`) via `castVote` / `castVoteWithReason`.
4. UI includes eligibility hints (delegation/quorum) and state countdowns.

### 5.3 Step 6: Queue then execute
1. For `Succeeded` proposals, app enables queue action.
2. Queue transaction calls `VfiGovernor.queue(targets, values, calldatas, descriptionHash)`.
3. For `Queued` proposals after timelock delay, app enables execute action.
4. Execute transaction calls `VfiGovernor.execute(targets, values, calldatas, descriptionHash)`.
5. UI derives `descriptionHash = keccak256(description)` (same as CLI).

### 5.4 Step 7: Verify
1. App reconstructs latest dapp versions from DappRegistry events:
   - `DappPublished`, `DappUpgraded`, `DappMetadata`, `DappPaused`, `DappUnpaused`, `DappDeprecated`.
2. App shows latest status (`Published|Paused|Deprecated|Unknown`) plus root CID and metadata.
3. App links verification to executed proposal and resulting registry change.

## 6. Contract Integration Plan
1. Bundle ABIs for `VfiGovernor`, `DappRegistry`, and `VfiToken` under `studio/abis/`.
2. Store deploy-time contract addresses in `studio/addresses.json` (Sepolia + future networks).
3. Reuse CLI-equivalent encoding and state logic in frontend utilities:
   - `encodeRootCid`
   - publish/upgrade calldata encoders
   - proposal description hash helper
   - proposal/dapp event reducers
4. Prefer chain-derived state over local mutable state to remain auditable/reproducible.

## 7. Suggested Studio App Structure
1. `studio/src/App.tsx` (routing and top-level layout).
2. `studio/src/env.ts` (RPC URL + chain checks).
3. `studio/src/eth/clients.ts` (public/wallet clients from injected providers).
4. `studio/src/eth/governor.ts` (proposal state reads + vote/queue/execute writes).
5. `studio/src/eth/registry.ts` (dapp event reads + publish/upgrade calldata builders).
6. `studio/src/state/reducers.ts` (log-to-view-model reducers).
7. `studio/src/components/*` (proposal table, proposal detail, publish form, verification table).
8. `studio/abis/*.json`, `studio/addresses.json`, `studio/manifest.json`.

## 8. Delivery Phases
1. Phase 1: Read-only DAO console.
   - proposal list/detail
   - dapp registry verification table
2. Phase 2: Write-path for step 4 and step 5.
   - propose publish
   - vote cast
3. Phase 3: Write-path for step 6.
   - queue + execute with state-based action gating
4. Phase 4: Hardening and UX safety.
   - transaction simulation/preflight
   - richer error handling
   - final compatibility checks against constraints

## 9. Testing and Validation Plan
1. Unit-test log reducers with recorded event fixtures.
2. Unit-test calldata/description-hash helpers against CLI outputs.
3. Manual E2E on Sepolia:
   - create proposal
   - vote
   - queue
   - execute
   - confirm `dapp:list` parity in UI
4. Constraint compliance check before packaging:
   - dependency/version pins
   - no forbidden patterns
   - artifact whitelist only

## 10. IPFS Access for vapps (Dedicated Design)
### 10.1 Problem
Current vapp constraints allow injected wallet/RPC but disallow arbitrary HTTP. That blocks safe, consistent in-vapp retrieval of IPFS assets (manifests, media, metadata), which studio and other vapps will likely need.

The critical requirement is stronger than "safe fetch":
1. vapps must not be able to retrieve content in a way that can become executable code.
2. IPFS retrieval must still support code-review UX and metadata use cases.

### 10.2 Design Goals
1. Keep decentralization: content addressed, verifiable by CID.
2. Keep security: no arbitrary network egress and no executable asset loading from IPFS into vapp runtime.
3. Keep compatibility: similar injection model to existing wallet/RPC.
4. Keep determinism: same input CIDs should produce same bytes across nodes/gateways.
5. Enforce guarantees in the host/client, not by trusting vapp code.

### 10.3 Proposed Capability Model
Add an injected read-only IPFS capability from host to vapps, analogous to `window.ethereum`, but data-only:
1. `window.vibefiIpfs.request({ method, params })` (or `window.vibefi.request` namespace extension).
2. Keep a small general API surface:
   - `vibefi_ipfsHead(cid, path?)` -> metadata only (`size`, `kind`, hashes, timestamps where available).
   - `vibefi_ipfsList(cid, path?, opts?)` -> deterministic listing for tree navigation and manifest inspection.
   - `vibefi_ipfsRead(cid, path, options)` -> typed inert data only, with `options.as` in:
     - `json` (parsed object, optional schema validation),
     - `text` (sanitized UTF-8 text),
     - `snippet` (bounded line/byte subset of sanitized text),
     - `image` (sanitized/re-encoded raster payload).
3. No generic `cat`/`raw bytes` method exposed to vapps in MVP.
4. No write/pin methods exposed to vapps in MVP.

### 10.4 Hard Execution Boundary (Non-Negotiable)
1. Treat IPFS as data capability only, never code capability.
2. Only executable JS originates from locally built bundle output served over `app://`.
3. IPFS content is never fed into:
   - dynamic import/module loaders,
   - script tags,
   - worker creation,
   - iframe navigation.
4. Client runtime enforces this independently of vapp behavior.

### 10.5 Runtime/CSP Enforcement Changes
1. Keep `connect-src 'none'` so vapps cannot directly fetch network resources.
2. Tighten script policy to remove inline execution where feasible in app webviews.
3. Set restrictive CSP defaults: `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, and no script execution from `blob:`/`data:`.
4. Add `X-Content-Type-Options: nosniff` on host-served responses.
5. Keep host IPC as the only network bridge.

### 10.6 Host-Side IPFS Firewall (Critical)
1. CID verification required before returning payload to vapp.
2. Allowlist only immutable `cid + path` access; reject scheme/URL inputs.
3. Hard size limits (global + per-call) to prevent memory abuse.
4. Parse-by-content and parser validation (not extension-only policy):
   - JSON must parse as UTF-8 JSON and optionally match known schema.
   - images must decode as expected media and be re-encoded by host before return.
   - text previews must be decoded as plain text with strict max bytes.
5. Deny active/executable content classes for vapp retrieval:
   - JavaScript/modules, HTML, WASM, SVG-as-active-content, PDFs with script, and other active formats.
6. Preserve CSP `connect-src 'none'`; all network access remains host-mediated IPC.
7. Enforce request-intent policy:
   - `as: json` must parse as JSON and fit schema/caps.
   - `as: text|snippet` must pass UTF-8 + text sanitizer.
   - `as: image` must decode and re-encode as allowed raster format.

### 10.7 Data Inertness Guarantees
1. JSON returned as structured data, not executable source.
2. Code review files are returned as inert text/tokens only.
3. Images are returned as decoded/re-encoded raster payloads (or safe host object references), not arbitrary original byte streams.
4. The API surface should make execution misuse hard by design.

### 10.8 Decentralization Strategy
1. Retrieval strategy in host:
   - local IPFS node first
   - trustless gateway fallback
2. On fallback, verify returned bytes against requested CID before exposing data.
3. Prefer multi-gateway fallback config for availability without changing trust model.

### 10.9 Studio Code Review Use Case
1. Studio builds review UX using only general methods:
   - `ipfsList` for file tree,
   - `ipfsHead` for metadata/hash/size,
   - `ipfsRead(..., { as: "snippet" })` for source previews.
2. Review is assembled client-side from inert outputs; no dedicated "review bundle" privileged method is required.
3. Optional static analysis can run in host as a separate governance-reviewed feature, but not as a required API surface.

### 10.10 Token List / Metadata Use Case
1. Use `ipfsRead(..., { as: "json", schemaId: "tokenlist.v1" })` for token lists and other metadata.
2. Optionally support signature verification for trusted publishers.
3. Return typed records only (tokens/chains/extensions), not raw payloads.

### 10.11 Safe Text and Code Snippet Retrieval (Detailed)
1. Request shape (example):
   - `vibefi_ipfsRead(cid, path, { as: "snippet", startLine, endLine, maxBytes, maxLines })`.
2. Host retrieval pipeline:
   - resolve and canonicalize `cid + path`,
   - fetch and verify content-addressed bytes,
   - enforce maximum file bytes before decoding.
3. Host text safety pipeline:
   - strict UTF-8 decode (invalid sequences rejected),
   - binary-content heuristic rejection (NUL and non-text ratio caps),
   - normalize line endings to `\n`,
   - strip/escape control characters except `\n` and `\t`,
   - detect and flag bidi/invisible control characters for review UI.
4. Snippet extraction policy:
   - apply hard caps (`maxLines`, `maxBytes`) before returning data,
   - return deterministic line ranges with truncation flags,
   - include `sha256`, `lineStart`, `lineEnd`, `truncatedHead`, `truncatedTail`.
5. Response shape (inert):
   - `{ kind: "snippet", text, metadata }` where `text` is plain string only,
   - optional token stream as structured JSON (`[{tokenType, text}]`) for highlighting,
   - never return executable module blobs.
6. Rendering rules for vapps:
   - render snippet via text nodes (`textContent`) only,
   - forbid HTML insertion path for snippet payloads,
   - disable "run/eval/import" actions for snippet payload origins.
7. This enables rich review workflows without introducing any code execution surface.

### 10.12 Manifest and Constraints Changes
1. Extend vapp constraints documentation to include injected IPFS capability as an approved resource.
2. Add optional manifest field describing expected IPFS data dependencies, e.g.:
   - `ipfsAccess.allowed: [{ cid, paths, maxBytes, contentTypes }]`
3. Host enforces that runtime IPFS reads stay within declared allowances (least privilege).
4. Studio can request broader read-only access than typical vapps only if explicitly declared and approved.
5. Include capability type declarations (e.g., `json`, `text`, `snippet`, `image`) so grants are behavior-scoped, not file-extension scoped.

### 10.13 Security Notes for Studio
1. Studio should treat IPFS data as untrusted user content.
2. Never use IPFS strings as HTML (`dangerouslySetInnerHTML`) or dynamic script import.
3. Keep rendering paths data-only (code as text, metadata as typed objects, images as sanitized bitmaps).
4. Display CID/path/hash provenance in UI for auditability.

### 10.14 Rollout Plan for IPFS Capability
1. Phase A: define typed API contract + CSP/runtime hardening requirements.
2. Phase B: implement host IPC provider with IPFS firewall and CID verification.
3. Phase C: implement studio review and metadata flows on top of typed APIs.
4. Phase D: formalize policy tests:
   - blocked executable formats,
   - no raw-byte API escape hatches,
   - CID mismatch rejection,
   - oversized payload rejection,
   - path traversal rejection,
   - snippet sanitizer invariants (control chars/bidi flags/truncation correctness).

## 11. Questions / Uncertainties
1. Should studio MVP support only `publishDapp` proposals, or also `upgradeDapp` on day one?
2. Should proposal discovery be bounded by deploy block from devnet metadata, or fully unbounded?
3. Do we want in-app packaging/upload in studio now, or keep packaging in CLI and studio only handles governance flow (steps 4-7)?
4. Should studio expose Security Council pause/unpause/deprecate actions in MVP, or keep governance-only controls first?
5. For IPFS capability, should non-studio vapps get the same API immediately, or should studio be pilot-only first?
6. Where should allowed IPFS capabilities be governed long-term: constraints registry, manifest policy, or both?

## 12. Assumptions
1. Sepolia deployed addresses in `contracts/.devnet/sepolia.json` are authoritative for initial studio work.
2. Users will run studio inside the VibeFi client runtime that injects wallet/RPC and enforces CSP/IPC boundaries.
3. No backend service will be introduced for governance actions; all writes are direct wallet transactions.
4. Studio remains within current approved package set unless separately approved.

## 13. Suggestions
1. Implement studio MVP strictly for steps 4-7 first, then layer packaging/upload UX later.
2. Extract shared proposal/registry helpers from CLI into `packages/shared` to avoid logic drift.
3. Add fixture-based parity tests comparing studio reducers/helpers vs CLI outputs.
4. Prioritize IPFS read-only capability design before adding any studio feature that depends on arbitrary off-chain data.
