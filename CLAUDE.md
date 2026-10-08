@AGENTS.md

## e2e tests (local only)

There is no CI. Before pushing to `main` or opening a PR to `main`, run `npm run test:e2e -- --exclude-tag voice` (drop the flag when `npm run voice` is running) and make sure it passes. Agent steps run on the local Claude Code subscription.

Passing `agent.act` steps are recorded to `.e2e/cache/` (gitignored) and replay on later local runs. Use `npm run test:e2e`, not `npx e2e run`: it wipes `.e2e/data` first, so the library starts empty and recorded targets (thread lists, counts) still match.
