/**
 * Nachricht der eingebetteten Seite an die einbettende (app/fragebogen/[id]/embed-helpers.tsx und der Schnipsel auf
 * der Verwaltungsseite, docs/KONZEPT-FRAGEBOGEN.md). Eigene Datei ohne Server-Abhängigkeiten, weil beide Seiten sie
 * brauchen - eine Konstante aus einer 'use client'-Datei käme in einer Server-Komponente nicht als Text an.
 */
export const HEIGHT_MESSAGE = 'abstimmungstool:hoehe'
