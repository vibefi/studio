# VibeFi Studio vapp Design (Sepolia Steps 4-7)

## 1. Goal
Build `studio` as a VibeFi-compatible vapp that is the primary governance entrypoint for the VibeFi DAO and can execute Sepolia deployment steps 4-7 from `contracts/README.md`:
1. Propose dapp publish/upgrade.
2. Vote on proposals.
3. Queue successful proposals.
4. Execute queued proposals.
5. Verify resulting dapp state from registry events.

## 2. Inputs Reviewed
1. `contracts/README.md` ("Sepolia Testnet Deployment" steps 4-7).
2. `dapp-examples/constraints.md` and `dapp-examples/README.md`.
3. CLI behavior in:
   - `cli/src/commands/dapp.ts`
   - `cli/src/commands/vote.ts`
   - `cli/src/commands/proposals.ts`
   - `cli/src/commands/registry.ts`
   - `cli/src/commands/governor.ts`
4. Client runtime model in:
   - `client/src/webview.rs`
   - `client/internal-ui/src/preload-app.ts`
   - `client/src/registry.rs`

## 3. Locked Decisions (Resolved)
1. Studio MVP supports `publishDapp` and `upgradeDapp` from day one.
2. Proposal/event discovery is bounded from deploy block onward.
3. Packaging and upload stay in CLI (not Studio).
4. Security Council pause/unpause/deprecate controls are out of Studio MVP.
5. IPFS capability is permissioned, declared in `manifest.json` capabilities.
6. Long-term governance model for IPFS access is manifest policy (`capabilities` section).
7. Token-list signature verification is not required in MVP.
8. Host returns plain text/snippet payloads only; formatting/highlighting is done in Studio frontend.
9. Trusted Types are mandatory in app webviews.
10. Strict CSP is required; plan must call out expected refactors.

## 4. Hard Constraints
1. Studio remains a VibeFi-compatible vapp (approved package set and artifact shape).
2. Writes use injected wallet (`window.ethereum`).
3. Reads use injected RPC (`RPC_URL`/`VITE_RPC_URL`).
4. No arbitrary outbound HTTP from vapps.
5. Runtime security controls are host-enforced; reviewer/agent checks are defense-in-depth only.

## 5. Functional Scope
### 5.1 Propose Publish/Upgrade (Step 4)
1. Collect `rootCid`, `name`, `dappVersion`, `description`, proposal description.
2. Encode `publishDapp(...)` and `upgradeDapp(...)` calldata.
3. Submit `VfiGovernor.propose(...)` transaction.

### 5.2 Vote (Step 5)
1. Load proposals from `ProposalCreated` logs (from deploy block).
2. Show state, snapshot/deadline, quorum and vote totals.
3. Submit `castVote` / `castVoteWithReason`.

### 5.3 Queue + Execute (Step 6)
1. Allow queue for `Succeeded` proposals.
2. Allow execute for `Queued` proposals after timelock delay.
3. Use `descriptionHash = keccak256(description)`.

### 5.4 Verify (Step 7)
1. Reconstruct dapp latest versions/status from registry events.
2. Show root CID + metadata + status and link to associated proposal flow.

## 6. IPFS Access Design
### 6.1 Core Model
Treat IPFS as a data capability, never a code capability.

### 6.2 API Surface (Small, General, Safe)
Expose injected read-only API:
1. `vibefi_ipfsHead(cid, path?)`
2. `vibefi_ipfsList(cid, path?, opts?)`
3. `vibefi_ipfsRead(cid, path, options)` where `options.as` is:
   - `json`
   - `text`
   - `snippet`
   - `image`

Non-goals for MVP:
1. No generic raw-byte/cat API.
2. No write/pin API.

### 6.3 Permissioning via Manifest Capabilities
1. Add `capabilities` section to manifest policy.
2. IPFS permissions are declared per vapp and enforced by host.
3. Capability declaration is behavior-scoped (`json|text|snippet|image`), not extension-scoped.

### 6.4 Hard Execution Boundary
IPFS data must not reach execution sinks:
1. No dynamic import/module loading from IPFS payload.
2. No `eval`, `new Function`, or string-based timer execution.
3. No script-tag or script-like DOM injection path.
4. No worker/iframe/srcdoc execution path.

### 6.5 Runtime/CSP Requirements
1. `connect-src 'none'`.
2. No `'unsafe-inline'` and no `'unsafe-eval'` in script policy.
3. No script execution from `blob:`/`data:`.
4. `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
5. `X-Content-Type-Options: nosniff` on host-served responses.
6. Use `Content-Disposition: attachment` for save/export-only paths.
7. Trusted Types required in app webviews.

### 6.6 Host-Side IPFS Firewall
1. Verify CID/content addressing before returning data.
2. Canonicalize and restrict `cid + path`; reject URL/scheme inputs.
3. Enforce byte/line/object limits.
4. Parse by content (not extension) and enforce request intent:
   - `json` must parse and fit schema/caps.
   - `text|snippet` must pass UTF-8 + sanitizer.
   - `image` must decode and be re-encoded as allowed raster.
5. Deny active formats (JS/HTML/WASM/SVG-active/PDF-active, etc.) for vapp retrieval.

### 6.7 Safe Text and Snippet Retrieval
For `as: "snippet"`:
1. Strict UTF-8 decode; reject invalid encoding.
2. Reject binary-like payloads via NUL/non-text heuristics.
3. Normalize line endings to `\n`.
4. Strip/escape unsafe control chars (except `\n` and `\t`).
5. Detect bidi/invisible controls and flag in metadata.
6. Return bounded deterministic ranges with truncation metadata.
7. Return plain text only; no executable output shape.

Rendering rule:
1. Studio renders text via text nodes (`textContent`) only.
2. No HTML insertion path.
3. No run/eval/import action for snippet-origin payloads.

### 6.8 Why Review Rules Alone Are Insufficient
1. Review rules can be bypassed or missed.
2. Generated/transitive code can reintroduce sinks.
3. Security must hold even with malicious vapps.
4. Therefore CSP + IPC + host validation are mandatory controls.

## 7. Project Structure (Studio App)
1. `studio/src/App.tsx`
2. `studio/src/env.ts`
3. `studio/src/eth/clients.ts`
4. `studio/src/eth/governor.ts`
5. `studio/src/eth/registry.ts`
6. `studio/src/state/reducers.ts`
7. `studio/src/components/*`
8. `studio/abis/*.json`, `studio/addresses.json`, `studio/manifest.json`

## 8. Validation
1. Helper parity tests against CLI behavior.
2. Reducer tests with event fixtures.
3. Manual Sepolia E2E: propose -> vote -> queue -> execute -> verify.
4. Security tests for blocked execution paths and snippet sanitizer invariants.

## 9. Refactor Notes (Strict CSP + Trusted Types)
Expected refactors are required in client/runtime and possibly app code:
1. Remove current `'unsafe-inline'` and `'unsafe-eval'` allowances from app CSP in `client/src/webview.rs`.
2. Audit Studio and internal UI for inline script usage and replace with non-inline patterns.
3. Ensure no execution-sink usage remains in frontend code paths handling IPFS data.
4. Add Trusted Types policy wiring and sink enforcement in app webviews.

## 10. Status
Design decisions are locked and reflected here. Detailed implementation sequencing is in `plan.md`.
