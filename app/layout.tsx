// app/layout.tsx
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import AccountNav from "./ui/account-nav";
import PwaRegister from "./ui/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Abstimmungstool",
  description: "Einfache, anonyme Gruppen-Abstimmungen",
  applicationName: "Abstimmungstool",
  // iOS: als App vom Home-Bildschirm ohne Safari-Leiste starten, mit eigenem Kurznamen.
  appleWebApp: { capable: true, title: "Abstimmen", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Färbt die Statusleiste/Titelleiste der installierten App (passend zu manifest.ts).
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased min-h-screen flex flex-col">
        {/* Der Konto-Status liest Cookies (dynamisch) - in Suspense, damit er den Rest der Seite nicht aufhält. */}
        <Suspense fallback={<div className="h-12" />}>
          <AccountNav />
        </Suspense>
        <div className="grow">{children}</div>
        <PwaRegister />
        <footer className="text-center text-xs text-gray-400 py-4">
          <Link href="/impressum" className="hover:underline">Impressum</Link>
          {" · "}
          <Link href="/datenschutz" className="hover:underline">Datenschutz</Link>
        </footer>
      </body>
    </html>
  );
}
