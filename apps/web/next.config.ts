import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@aporia/scenario", "@aporia/engine", "@aporia/db", "@aporia/prompts", "@aporia/worker"],
  serverExternalPackages: ["pg", "graphile-worker", "@anthropic-ai/sdk", "@anthropic-ai/bedrock-sdk"],
  outputFileTracingRoot: path.join(process.cwd(), "../../"),
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Workspace packages use Node16-style ".js" specifiers that resolve to ".ts" sources.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
  turbopack: { resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"] },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ],
    },
  ],
};
export default config;
