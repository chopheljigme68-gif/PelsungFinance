import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { AppProvider } from "@/providers/app-provider";
import "./globals.css";

/**
 * Space Grotesk — a modern geometric grotesque. Vendored into the repo and
 * loaded by next/font/local: no build-time network fetch, no external request
 * at runtime, no layout shift. Exposed as the `--font-sans` CSS variable that
 * globals.css uses everywhere.
 */
const sans = localFont({
  src: [
    { path: "./fonts/space-grotesk-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/space-grotesk-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/space-grotesk-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/space-grotesk-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

const title = "Pelsung Finance | Accounting Management System";
const description =
  "Role-secured voucher processing, payroll, approvals and financial reporting for Pelsung.";

/** Set NEXT_PUBLIC_SITE_URL in production so social previews resolve absolutely. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og-v3.png", width: 1536, height: 1024, alt: "Pelsung Finance — Prepare. Approve. Account. Report." }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-v3.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
