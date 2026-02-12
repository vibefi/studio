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

### 10.2 Design Goals
1. Keep decentralization: content addressed, verifiable by CID.
2. Keep security: no arbitrary network egress; no executable asset loading from IPFS into vapp runtime.
3. Keep compatibility: similar injection model to existing wallet/RPC.
4. Keep determinism: same input CIDs should produce same bytes across nodes/gateways.

### 10.3 Proposed Capability Model
Add an injected read-only IPFS capability from host to vapps, analogous to `window.ethereum`:
1. `window.vibefiIpfs.request({ method, params })` (or `window.vibefi.request` namespace extension).
2. Supported methods (MVP):
   - `vibefi_ipfsHead(cid, path?)` -> returns `{ cid, path, size, contentType }`.
   - `vibefi_ipfsCat(cid, path?, opts?)` -> returns bytes (base64/hex) with strict size cap.
   - `vibefi_ipfsGetJson(cid, path)` -> returns parsed JSON only after size/type checks.
3. No write/pin methods exposed to vapps in MVP.

### 10.4 Host-Side Enforcement (Critical)
1. CID verification required before returning payload to vapp.
2. Allowlist only immutable `cid + path` access; reject scheme/URL inputs.
3. Hard size limits (global + per-call) to prevent memory abuse.
4. Media type and extension policy:
   - allow data assets (`.json`, `.webp`, `.png`, `.jpg`, `.txt`, etc.)
   - block executable/script-like assets (`.js`, `.mjs`, `.html`, `.svg` unless sanitized, `.wasm`)
5. Return raw bytes/data only; never auto-execute or mount remote code.
6. Preserve CSP `connect-src 'none'`; all network access remains host-mediated IPC.

### 10.5 Decentralization Strategy
1. Retrieval strategy in host:
   - local IPFS node first
   - trustless gateway fallback
2. On fallback, verify returned bytes against requested CID before exposing data.
3. Prefer multi-gateway fallback config for availability without changing trust model.

### 10.6 Manifest and Constraints Changes
1. Extend vapp constraints documentation to include injected IPFS capability as an approved resource.
2. Add optional manifest field describing expected IPFS data dependencies, e.g.:
   - `ipfsAccess.allowed: [{ cid, paths, maxBytes, contentTypes }]`
3. Host enforces that runtime IPFS reads stay within declared allowances (least privilege).
4. Studio can request broader read-only access than typical vapps only if explicitly declared and approved.

### 10.7 Security Notes for Studio
1. Studio should treat IPFS data as untrusted user content.
2. Never use IPFS strings as HTML (`dangerouslySetInnerHTML`) or dynamic script import.
3. Parse JSON with schema checks before use.
4. Display CID/path provenance in UI for auditability.

### 10.8 Rollout Plan for IPFS Capability
1. Phase A: define API contract + constraints updates.
2. Phase B: implement host IPC provider and enforcement layer.
3. Phase C: add studio read-only integration for manifests/metadata previews.
4. Phase D: formalize policy tests (blocked executable types, CID mismatch, oversized payloads).

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
