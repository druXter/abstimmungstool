import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 1 (dieses Grundgerüst): komplett eigenständiges Tool, keine Einbettung
  // vorgesehen - daher noch keine explizite Content-Security-Policy/X-Frame-Options
  // nötig (Browser blockieren iFraming nur, wenn ein Header das ausdrücklich verlangt).
  // Sobald die geplante, rein optionale Einbindung in rsvp-app (Phase 3) umgesetzt
  // wird, gehört hier eine `frame-ancestors`-Policy hin, die NUR die rsvp-app-Domain
  // erlaubt statt generell alles zuzulassen.
};

export default nextConfig;
