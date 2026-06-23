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

  // pdfjs-dist loads its worker (pdf.worker.mjs) via a DYNAMIC import, which Vercel's
  // file tracer can't follow — so the worker is missing from the serverless bundle and
  // pdfjs throws "Cannot find module .../pdf.worker.mjs" the moment it rasterizes or
  // text-extracts a PDF. Force-include it for every route that touches pdfjs. (Trace
  // keys use picomatch contains-matching, so "/api/admin/forms" also covers its
  // dynamic [id] subroutes: page-image, known, and the approve handler.)
  outputFileTracingIncludes: {
    "/api/jobs/process": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/me/forms": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/admin/forms": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;
