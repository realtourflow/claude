import { NextRequest, NextResponse } from "next/server";

const MARKETING_HOSTS = new Set(["realtourflow.com", "www.realtourflow.com"]);

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

  // On the explicit app domain, /landing is internal — block direct access.
  // localhost passes through so the landing page can be previewed locally.
  if (
    host === "app.realtourflow.com" &&
    (pathname === "/landing" || pathname.startsWith("/landing/"))
  ) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
