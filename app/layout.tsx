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
      <body className="antialiased min-h-screen flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        {/* Der Konto-Status liest Cookies (dynamisch) - in Suspense, damit er den Rest der Seite nicht aufhält. */}
        <Suspense fallback={<div data-chrome className="h-14 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 print:hidden" />}>
          <AccountNav />
        </Suspense>
        <div className="grow">{children}</div>
        <PwaRegister />
        <footer data-chrome className="border-t border-gray-200 py-4 text-center text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500 print:hidden">
          <Link href="/impressum" className="hover:underline">Impressum</Link>
          {" · "}
          <Link href="/datenschutz" className="hover:underline">Datenschutz</Link>
        </footer>
      </body>
    </html>
  );
}
