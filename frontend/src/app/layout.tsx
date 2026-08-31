import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProvider } from "@/providers/app-provider";
import "./globals.css";

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
    <html lang="en">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
