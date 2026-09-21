// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import AccountNav from "./ui/account-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Abstimmungstool",
  description: "Einfache, anonyme Gruppen-Abstimmungen",
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
        <footer className="text-center text-xs text-gray-400 py-4">
          <Link href="/impressum" className="hover:underline">Impressum</Link>
          {" · "}
          <Link href="/datenschutz" className="hover:underline">Datenschutz</Link>
        </footer>
      </body>
    </html>
  );
}
