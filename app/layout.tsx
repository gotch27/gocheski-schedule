import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: "Gocheski Mind",
    description: "A focused weekly calendar for shaping your time.",
    openGraph: {
      title: "Gocheski Mind",
      description: "Make room for what matters.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Gocheski Mind weekly calendar" }]
    },
    twitter: {
      card: "summary_large_image",
      title: "Gocheski Mind",
      description: "Make room for what matters.",
      images: [`${origin}/og.png`]
    }
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
