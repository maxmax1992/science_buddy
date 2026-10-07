import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { claudeExecutor } from "./tests/claude-executor";

const claudeEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (e): e is [string, string] => e[1] !== undefined && /^(USER|LOGNAME|CLAUDE_\w+|ANTHROPIC_\w+)$/.test(e[0]),
  ),
);

export default {
  // agent.act / agent.assert run on Claude through the logged-in Claude Code subscription (see tests/claude-executor.ts).
  agents: { default: { executor: claudeExecutor } },
  // Its own server, library (.e2e/data) and build dir, so tests never touch your papers or threads.
  targets: [
    {
      engine: web(),
      app: {
        url: process.env.APP_URL ?? "http://localhost:3100",
        command: {
          executable: "npm",
          args: ["run", "dev:e2e"],
          // The runner passes only PATH/HOME/TMPDIR; Claude Code's keychain login also needs USER.
          env: claudeEnv,
          reuseExisting: true,
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
  // Real Claude answers take a minute or two; tests share one local library, so run them one at a time.
  timeout: 360_000,
  workers: 1,
} satisfies E2EConfig;
