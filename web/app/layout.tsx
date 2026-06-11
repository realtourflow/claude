import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "RealTour Flow",
  description: "Stage-based real estate deal operating system",
};

// SPA pages all depend on Auth0 client state, so static prerendering at build
// time fails. Force dynamic rendering across the whole app — same behavior as
// the original Vite SPA. Server Components / partial prerendering can be opted
// back in later on specific routes when we add data fetching.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased scroll-smooth">
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
