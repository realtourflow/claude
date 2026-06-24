import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No build-time silencers — typecheck runs against the real codebase.
  // ESLint is configured via eslint.config.mjs (Next.js 16 flat config) and
  // enforced through CI's `npm run lint` step. Lint cleanup is tracked as
  // a follow-up PR.

  // @napi-rs/canvas (the serverless PDF→PNG renderer for vision/overlay) ships a
  // native .node binding Turbopack can't bundle — keep it a runtime require on the
  // server. pdfjs-dist's legacy build is heavy + node-targeted, so externalize it too.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
