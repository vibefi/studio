# VibeFi Studio

VibeFi Studio is the governance-focused vapp entrypoint for DAO workflows.

Current scope:
1. Propose `publishDapp` and `upgradeDapp` governance actions.
2. Vote, queue, and execute proposals.
3. Verify DappRegistry state from on-chain events.
4. Review packaged vapps via injected `vibefiIpfs`:
   - load manifest-scoped file listings
   - browse and filter files
   - open safe snippet windows with pagination and file metadata

For strategy and security design details, see `design.md`.
For implementation sequencing across repos, see `plan.md`.
