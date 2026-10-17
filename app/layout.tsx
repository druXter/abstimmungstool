// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { AppFooter, PwaRegister } from "./ui/kit";
import { Suspense } from "react";
import AccountNav from "./ui/account-nav";
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
        <Suspense fallback={<div data-chrome className="h-14 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 print:hidden" />}>
          <AccountNav />
        </Suspense>
        <div className="grow">{children}</div>
        <PwaRegister />
        <AppFooter />
      </body>
    </html>
  );
}
