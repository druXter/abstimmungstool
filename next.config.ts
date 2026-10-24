import type { NextConfig } from "next";
import { BASE_RULE, NO_FRAMING, NO_REFERRER, NOT_STORED, PRIVATE_PAGE, SECRET_URL_PAGE, SUITE_RULES } from "suite-kit/web";

const nextConfig: NextConfig = {
  // Live-Runden: Fragen mit Bildern gehen in EINER Server Action an den Server (Editor verkleinert
  // jedes Bild vorher, app/lib/live-images.ts prüft höchstens 1,5 MB pro Bild). Standard wäre 1 MB.
  experimental: {
    serverActions: { bodySizeLimit: '16mb' }
  },

  // Sicherheits-Header aus den Bausteinen von suite-kit (docs/KONVENTIONEN.md, "Sicherheits-Header"); hier stehen
  // nur die Pfade dieses Tools. Bewusst KEINE Einbettung in fremde Seiten
  // (frame-ancestors 'none'): Login, Verwaltung und Konto-Seiten dürfen nicht in einem
  // unsichtbaren iFrame auftauchen (Clickjacking). Die Verzahnung mit rsvp-app läuft über
  // normale Links, nicht über Einbettung.
  //
  // Einzige Ausnahme: der eingebettete Fragebogen (/fragebogen/<id>/einbetten, docs/KONZEPT-FRAGEBOGEN.md).
  // Die Regel mit X-Frame-Options und frame-ancestors 'none' nimmt diesen Pfad aus; frame-ancestors mit den
  // erlaubten Domains setzt dort proxy.ts - zur Laufzeit, weil EMBED_ALLOWED_ORIGINS in der .env steht, die
  // beim Bauen des Images nicht vorliegt (diese Header stehen nach dem Build fest).
  //
  // Nicht gesetzt: eine vollständige Content-Security-Policy. Sie würde für Next.js
  // Nonces pro Anfrage brauchen (siehe node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md) und die Seiten dynamisch machen - der Nutzen ist hier
  // gering, da nirgends fremder Inhalt als HTML ausgegeben wird (React maskiert alles).
  async headers() {
    return [
      BASE_RULE,
      {
        // Alles außer dem eingebetteten Fragebogen (siehe oben). Der Pfad ist "/<anything>" ohne die Form
        // "fragebogen/<id>/einbetten" - auch mit angehängtem Schrägstrich, den Next.js sonst umleitet.
        source: "/:path((?!fragebogen/[^/]+/einbetten/?$).*)",
        headers: NO_FRAMING,
      },
      // Login, Konto und Verwaltung: nicht einbetten, nicht indexieren, nicht cachen.
      { source: "/:page(anmelden|konto|nutzer|meine-abstimmungen|erstellen|passwort-vergessen)", headers: PRIVATE_PAGE },
      { source: "/anmelden/:path*", headers: PRIVATE_PAGE },
      { source: "/:area(live|sitzung|fragebogen)/:id/:page(verwalten|bearbeiten|praesentieren)/:path*", headers: PRIVATE_PAGE },
      { source: "/:pollId/verwalten/:path*", headers: PRIVATE_PAGE },
      // Einmal-Links aus Mails (Passwort-Reset, Bestätigung der Stimme): zusätzlich kein Referer.
      { source: "/passwort-zuruecksetzen", headers: SECRET_URL_PAGE },
      { source: "/:pollId/bestaetigen", headers: SECRET_URL_PAGE },
      {
        // Tafel einer Sitzung (/sitzung/<id>/tafel?k=...): Der Schlüssel steht in der URL - kein Referer, kein Cache,
        // kein Index. Steht nach der allgemeinen Regel und überschreibt deren Referrer-Policy.
        source: "/sitzung/:id/tafel",
        headers: [...NO_REFERRER, ...NOT_STORED],
      },
      // Service Worker (nie cachen, eigene CSP) und Föderations-Endpunkte (Einmal-Werte in der URL, kein Referer) -
      // zuletzt, damit sie die Regeln davor überschreiben.
      ...SUITE_RULES,
    ];
  },
};

export default nextConfig;
