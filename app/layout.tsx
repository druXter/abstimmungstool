// app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
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
        <div className="grow">{children}</div>
        <footer className="text-center text-xs text-gray-400 py-4">
          <Link href="/impressum" className="hover:underline">Impressum</Link>
        </footer>
      </body>
    </html>
  );
}
