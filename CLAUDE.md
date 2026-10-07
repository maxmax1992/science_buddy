@AGENTS.md

## e2e replay cache

Before pushing to `main` or opening a PR to `main`, run the e2e suite locally so CI can replay it:

1. `npm run test:e2e -- --exclude-tag voice` (drop the flag when `npm run voice` is running). Agent steps run on the local Claude Code subscription, and every passing `agent.act` is recorded to `.e2e/cache/`.
2. Commit any changes under `.e2e/cache/` in the same PR. CI replays the cache read-only and never records.

Re-run after adding or editing an `agent.act`, or after changing the UI one drives: a step without a recording needs a live model in CI, and CI runs `--strict-cache`, so a stale recording fails the check.

Record with `npm run test:e2e`, not `npx e2e run`: it wipes `.e2e/data` first, so the library starts empty like CI's and recorded targets (thread lists, counts) match there.
