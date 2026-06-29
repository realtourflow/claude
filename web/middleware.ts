import { NextRequest, NextResponse } from "next/server";

const MARKETING_HOSTS = new Set(["realtourflow.com", "www.realtourflow.com"]);

// Marketing pages that live on the root domain (not the app). Served on the
// marketing host; kept canonical there (redirected off the app host).
function isBlogPath(pathname: string): boolean {
  return pathname === "/blog" || pathname.startsWith("/blog/");
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  if (MARKETING_HOSTS.has(host)) {
    // API routes called by the landing page form pass through as-is.
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    // Rewrite / → /landing internally. Browser URL stays clean.
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/landing", req.url));
    }
    // The blog + SEO files live on the marketing domain — serve them directly.
    if (isBlogPath(pathname) || pathname === "/sitemap.xml" || pathname === "/robots.txt") {
      return NextResponse.next();
    }
    // Any other path on the marketing domain (e.g. /agent, /buyer) → send
    // to the real app so deep links still work.
    return NextResponse.redirect(
      new URL(
        `https://app.realtourflow.com${pathname}${req.nextUrl.search}`,
        req.url
      ),
      301
    );
  }

  // On the explicit app domain, keep marketing-only pages canonical on the root
  // domain. localhost passes through so both can be previewed locally.
  if (host === "app.realtourflow.com") {
    // /landing is internal — block direct access.
    if (pathname === "/landing" || pathname.startsWith("/landing/")) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    // The blog belongs on the marketing site — redirect it there.
    if (isBlogPath(pathname)) {
      return NextResponse.redirect(
        new URL(
          `https://www.realtourflow.com${pathname}${req.nextUrl.search}`,
          req.url
        ),
        301
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
