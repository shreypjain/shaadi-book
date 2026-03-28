import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/BottomNav";
import { UserMenu } from "@/components/UserMenu";

export const metadata: Metadata = {
  title: "Shaadi Book",
  description: "Live prediction market for Parsh & Spoorthi's wedding in Udaipur",
  manifest: "/manifest.json",
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
      <body className="min-h-screen bg-cream-100 text-[#1a1a2e] font-sans">
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
