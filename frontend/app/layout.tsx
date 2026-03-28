import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/BottomNav";
import { UserMenu } from "@/components/UserMenu";

export const metadata: Metadata = {
  title: "Shaadi Book | Parsh & Spoorthi's Wedding",
  description:
    "Place your bets on wedding moments at Leela Palace, Udaipur. Live prediction markets for Parsh & Spoorthi's shaadi — real stakes, real fun, real charity.",
  manifest: "/manifest.json",
  metadataBase: new URL("https://parshandspoorthi.com"),
  openGraph: {
    title: "Shaadi Book",
    description:
      "Live prediction markets for Parsh & Spoorthi's wedding at Leela Palace, Udaipur. Bet on wedding moments. 20% of winnings go to charity.",
    url: "https://parshandspoorthi.com",
    siteName: "Shaadi Book",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Shaadi Book — Prediction Markets for Parsh & Spoorthi's Wedding",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shaadi Book",
    description:
      "Live prediction markets for Parsh & Spoorthi's wedding at Leela Palace, Udaipur.",
    images: ["/og-image.svg"],
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Shaadi Book",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1e3a5f",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream-100 text-[#1a1a2e] font-sans font-light">
        <Providers>
          {/* Auth-aware user menu — hidden on /login */}
          <UserMenu />
          {children}
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
