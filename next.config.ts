import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second dev server (e2e, port 3100) needs its own build dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Claude Agent SDK spawns a native CLI binary resolved from node_modules; don't bundle it.
  serverExternalPackages: ["ai-sdk-provider-claude-code", "@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
