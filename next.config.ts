import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sicherheits-Header für alle Seiten. Bewusst KEINE Einbettung in fremde Seiten
  // (frame-ancestors 'none'): Login, Verwaltung und Konto-Seiten dürfen nicht in einem
  // unsichtbaren iFrame auftauchen (Clickjacking). Die Verzahnung mit rsvp-app läuft über
  // normale Links, nicht über Einbettung. Gibt es später doch einen Einbettungs-Fall,
  // gehört hier gezielt NUR die betroffene Domain hin statt einer generellen Freigabe.
  //
  // Nicht gesetzt: eine vollständige Content-Security-Policy. Sie würde für Next.js
  // Nonces pro Anfrage brauchen (siehe node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md) und die Seiten dynamisch machen - der Nutzen ist hier
  // gering, da nirgends fremder Inhalt als HTML ausgegeben wird (React maskiert alles).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Nur für diesen Host (ohne includeSubDomains), damit andere Subdomains der
          // Suite davon unberührt bleiben. Wirkt nur über HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        // Der Service Worker darf NIE aus einem Cache kommen (Browser, Cloudflare, Proxy), sonst blieben
        // Nutzer auf einer alten Version hängen und Korrekturen kämen nicht an. Eigene CSP: Er lädt
        // ausschließlich Skripte und Ressourcen derselben Herkunft. Steht NACH der allgemeinen Regel und
        // überschreibt deren CSP (dort nur frame-ancestors) - deshalb wird frame-ancestors hier wiederholt.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
        ],
      },
      {
        // Die Föderations-Endpunkte tragen Einmal-Werte (Login-Bestätigung, state) in der
        // URL. Diese Regel steht NACH der allgemeinen und überschreibt deren Referrer-Policy:
        // ohne sie würde "strict-origin-when-cross-origin" das route-eigene "no-referrer" aushebeln.
        source: "/api/suite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
