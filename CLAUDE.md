@AGENTS.md

Regeln für alle Tools (Betrieb, Header, Anbindungen, Ausgaben, Tests): `../suite-kit/docs/KONVENTIONEN.md`. Gemeinsame
Helfer kommen aus suite-kit statt aus einer eigenen Kopie: `renderMail` (alle Mails, nie eigenes HTML), `escapeHtml`, `csvResponse`/`toCsv`, `readLimitedText` und
die Header-Bausteine aus `suite-kit/web`, `safeEqual`, `signLinkMessage`/`verifyLinkMessage` und `askAi` (KI-Zusammenfassung, `app/lib/survey-summary.ts`) aus `suite-kit`.
