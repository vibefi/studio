# VibeFi Studio Implementation Plan (Concrete, Cross-Repo)

## 1. Objective
Implement Studio as the DAO governance vapp for Sepolia steps 4-7, plus manifest-capability-gated IPFS read support with host-enforced non-executability guarantees.

Locked decisions applied:
1. Include `upgradeDapp` in MVP.
2. Query logs from deploy block onward.
3. Keep packaging/upload in CLI.
4. Exclude Security Council actions from Studio MVP.
5. IPFS access is gated by manifest `capabilities` policy.
6. Manifest policy is the source of truth for IPFS capabilities.
7. Token-list signature verification is not required in MVP.
8. Host returns plain text/snippets only; formatting is frontend concern.
9. Trusted Types are mandatory.
10. Strict CSP is required (with explicit refactor work below).

## 2. Delivery Strategy
Implement in this order to reduce integration risk:
1. `packages/shared` (shared types and validators).
2. `cli` (manifest capability validation and packaging behavior).
3. `dapp-examples` docs/constraints update (authoring contract).
4. `client` (runtime enforcement + IPFS IPC capability).
5. `studio` (actual governance UI + capability usage).
6. `contracts` docs-only confirmation (no contract code changes needed for MVP).

## 3. Repo-by-Repo Change Plan

### 3.1 `packages/shared` (Monorepo package)
Goal: provide canonical manifest capability types/validation used by CLI and client.

Files to add/update:
1. `packages/shared/src/manifest.ts` (new)
   - Define manifest schema/types for `capabilities`.
   - Add validation helpers for IPFS read permissions.
2. `packages/shared/src/index.ts`
   - Export manifest types/validators.
3. `packages/shared/src/ipfs.ts`
   - Keep existing CLI-oriented functions.
   - Add shared parsing helpers for IPFS path normalization and size-cap option types (no runtime IPC logic here).
4. `packages/shared/package.json`
   - No new deps unless strictly required.

Acceptance checks:
1. Invalid capabilities fail validation with clear errors.
2. Valid capabilities are stable/serializable and usable by both CLI and client.

### 3.2 `cli` submodule
Goal: keep packaging/upload in CLI and enforce capability policy shape at package time.

Files to update:
1. `cli/src/package.ts`
   - Require/validate `manifest.json` capabilities section.
   - Enforce capability type allowlist (`json|text|snippet|image`) and per-entry limits.
   - Keep current no-arbitrary-fetch constraints.
2. `cli/src/commands/package.ts`
   - Surface capability validation errors clearly.
3. `cli/src/commands/dapp.ts`
   - No behavior shift for governance commands; ensure docs/examples align with Studio flow.

Optional (if needed for UX):
1. `cli/src/commands/package.ts`
   - Add a flag to print normalized capability summary in package output JSON.

Acceptance checks:
1. Package fails when manifest lacks required capability policy shape.
2. Package passes with valid manifest capabilities and unchanged bundling behavior.
3. Upload/publication flow remains CLI-driven only.

### 3.3 `dapp-examples` submodule
Goal: formalize authoring constraints and manifest capability contract.

Files to update:
1. `dapp-examples/constraints.md`
   - Add `manifest.json` capabilities schema section.
   - Document that IPFS reads are only through injected `vibefiIpfs` API.
   - Document prohibited execution sinks for IPFS-derived data.
2. `dapp-examples/README.md`
   - Add capability-based IPFS guidance.
3. `dapp-examples/prompt.md`
   - Add explicit constraints for snippet rendering (`textContent` only, no HTML insertion).

Acceptance checks:
1. Constraints explicitly describe capability-gated IPFS access.
2. Authoring prompt matches runtime security model.

### 3.4 `client` submodule
Goal: enforce runtime boundaries (CSP, Trusted Types, IPC-only IPFS data path, no execution sinks).

Files to update:
1. `client/src/ipc_contract.rs`
   - Add provider ID/method contracts for IPFS IPC requests.
2. `client/internal-ui/src/preload-app.ts`
   - Inject `window.vibefiIpfs.request(...)` bridge.
   - Keep wallet/provider APIs unchanged.
3. `client/src/ipc/router.rs`
   - Route new IPFS provider methods to dedicated handler.
4. `client/src/ipc/mod.rs`
   - Register and expose IPFS handler module.
5. `client/src/ipc/ipfs.rs` (new)
   - Implement `ipfsHead`, `ipfsList`, `ipfsRead` request handling.
   - Enforce capability checks from manifest policy.
   - Enforce request intent (`as: json|text|snippet|image`).
6. `client/src/registry.rs` and/or manifest-loading path
   - Parse and persist manifest capabilities in runtime launch context.
7. `client/src/webview.rs`
   - Replace current permissive script CSP (`'unsafe-inline'`) with strict script policy.
   - Enforce no `'unsafe-eval'`, no script from `blob:`/`data:`.
   - Add/confirm `X-Content-Type-Options: nosniff` headers for custom-protocol responses.
   - Add `Content-Disposition: attachment` for export-only responses where applicable.
   - Add Trusted Types CSP directives and enforcement hooks.
8. `client/src/bundle.rs`
   - Keep bundle build path unchanged; ensure generated/served content remains compatible with strict CSP.

Security-critical implementation details:
1. Canonicalize and validate all `cid + path` requests.
2. Strict UTF-8 + sanitizer pipeline for `text` and `snippet`.
3. Return plain snippet payload only (no host-side formatting token stream in MVP).
4. Reject active formats and raw-byte escape hatches.
5. Fail closed when capability permission is missing.

Refactor scope expected in client/internal UI:
1. Any inline script usage in app/internal pages must be removed or replaced.
2. Any logic relying on eval-like behavior must be removed.
3. Trusted Types violations must be fixed before enabling by default.

Acceptance checks:
1. IPFS methods are inaccessible without manifest capability grant.
2. IPFS payload cannot be executed through runtime-supported sinks.
3. CSP blocks inline/eval/blob/data script execution.
4. Trusted Types enforcement is active in app webviews.

### 3.5 `studio` submodule
Goal: implement the governance UI plus safe IPFS-backed review/metadata experiences.

Files to add:
1. `studio/src/main.tsx`
2. `studio/src/App.tsx`
3. `studio/src/env.ts`
4. `studio/src/eth/clients.ts`
5. `studio/src/eth/governor.ts`
6. `studio/src/eth/registry.ts`
7. `studio/src/ipfs/client.ts` (typed wrapper around injected API)
8. `studio/src/state/reducers.ts`
9. `studio/src/components/*`
10. `studio/abis/VfiGovernor.json`
11. `studio/abis/DappRegistry.json`
12. `studio/abis/VfiToken.json`
13. `studio/addresses.json`
14. `studio/manifest.json` (with `capabilities` section)
15. `studio/index.html`
16. `studio/package.json`, `studio/tsconfig.json`, `studio/vite.config.ts`

Feature breakdown:
1. Governance actions:
   - Propose publish.
   - Propose upgrade.
   - Vote.
   - Queue.
   - Execute.
2. Verification views:
   - Proposal state/timings from deploy block.
   - Dapp registry latest-state projection.
3. IPFS-backed review:
   - Tree/listing + file metadata via `ipfsList`/`ipfsHead`.
   - Plain snippet preview via `ipfsRead(..., { as: "snippet" })`.
   - Plain rendering only (`textContent`).

Out of scope for Studio MVP:
1. Packaging/upload UX.
2. Security Council action UI.
3. Host-side snippet formatting/tokenization.

Acceptance checks:
1. Full Sepolia steps 4-7 can be completed in Studio.
2. Review UI uses only safe IPFS methods and plain rendering.
3. No HTML injection path for IPFS-derived content.

### 3.6 `contracts` submodule
Goal: confirm no on-chain changes are required for this MVP.

Files to update:
1. `contracts/README.md` (optional clarifications only)
   - Note Studio as frontend path for steps 4-7 once delivered.

No smart contract code changes planned:
1. `contracts/src/*` unchanged.
2. `contracts/script/*` unchanged for this scope.

Acceptance checks:
1. Existing deployment artifacts and events are sufficient for Studio MVP.

## 4. Cross-Repo Integration Points
1. Manifest capability schema must match between:
   - `packages/shared` validator,
   - CLI packaging validation,
   - client runtime enforcement,
   - Studio manifest authoring.
2. Proposal/event decoding in Studio must match CLI behavior.
3. Deploy-block-bounded queries must use the same source of truth as CLI/devnet config.

## 5. Refactor Checklist for Strict CSP + Trusted Types
Mandatory before enabling by default:
1. Remove script `'unsafe-inline'` allowance from client app-webview CSP.
2. Ensure no runtime dependency on inline script execution in vapps.
3. Confirm no eval/new Function/string-timer sink usage in Studio and internal UI paths.
4. Enable Trusted Types and fix resulting violations.
5. Verify no blob/data script execution path remains.

## 6. Test Plan
### 6.1 Unit
1. Manifest capability validator tests (`packages/shared`).
2. CLI package capability validation tests (`cli`).
3. Client IPFS handler tests:
   - permission denied without capability,
   - CID/path normalization,
   - intent mismatch rejection,
   - snippet sanitizer invariants.
4. Studio reducer/helper tests against recorded logs.

### 6.2 Integration
1. End-to-end launch of Studio in client runtime with strict CSP enabled.
2. Studio governance flow on Sepolia from deploy block:
   - propose publish/upgrade,
   - vote,
   - queue,
   - execute,
   - verify in registry view.
3. IPFS permission tests:
   - allowed path works,
   - disallowed path denied,
   - disallowed content kind denied.

### 6.3 Security Regression
1. Attempt execution via snippet payload and confirm blocked.
2. Attempt HTML/script injection with IPFS text and confirm inert rendering.
3. Attempt `eval`/`new Function` path and confirm blocked by CSP/runtime policy.

## 7. PR/Delivery Breakdown
1. PR A (`packages/shared` + `cli`): capabilities schema + package validation.
2. PR B (`dapp-examples`): constraints/prompt/readme updates.
3. PR C (`client`): IPC IPFS provider + CSP/Trusted Types hardening.
4. PR D (`studio`): governance UI + safe IPFS review UI.
5. PR E (optional `contracts` docs): add Studio usage notes.

## 8. Done Criteria
1. `design.md` decisions are implemented, not just documented.
2. Studio can run Sepolia steps 4-7 including upgrade proposals.
3. IPFS access is capability-gated by manifest policy and host-enforced.
4. Strict CSP + Trusted Types are active in app webviews.
5. Packaging/upload remains CLI-only.
