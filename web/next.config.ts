import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No build-time silencers — typecheck runs against the real codebase.
  // ESLint is configured via eslint.config.mjs (Next.js 16 flat config) and
  // enforced through CI's `npm run lint` step. Lint cleanup is tracked as
  // a follow-up PR.
};

export default nextConfig;
