# ToDo / Roadmap

Ziel: das Abstimmungstool auch **ohne** RSVP-Verknüpfung mächtiger machen. Stand: 2026-09-30.
Punkte mit **[rsvp-app]** oder **[suite-kit]** betreffen auch andere Repos der Suite (`~/rsvp-app`, `~/suite-kit`).
Nach jedem erledigten Punkt README und ggf. Datenschutzerklärung (`app/datenschutz/page.tsx`) nachziehen.

---

## A. Schutz vor Mehrfachabstimmung

### A0. Grundlage: Identitätsmodell verallgemeinern (Voraussetzung für A1-A5)

- [x] `Poll.voterIdentity` (Enum: `COOKIE`, `LINK`, `EMAIL`, `ACCOUNT`, `RSVP`) ersetzt den Schalter
      `requireRsvpVerification`.
- [x] `Vote`: `identityKind` + `voterKey` statt `voterToken`/`verifiedEmail`, Eindeutigkeit per
      `@@unique([pollId, voterKey, optionId])`. `replaceVotes`/`castVote` (`app/actions.ts`) lösen nur noch
      einen Schlüssel auf.
- [x] Umzugsskript für die Bestandsdaten (Cookie- und RSVP-Stimmen). Es gibt keinen `migrations`-Ordner, nur
      `db push` - Skript einmalig vor/nach dem Push ausführen, Backup vorher.
- [x] `showVoterNames` auf alle Modi mit Namen/E-Mail verallgemeinern (heute nur mit RSVP wirksam).

### A1. Persönliche Stimmlinks

- [x] Verwaltung gibt eine Namensliste (oder nur eine Anzahl) ein, pro Person ein Link `/[pollId]?k=…`.
- [x] In der DB nur der SHA-256-Hash (wie Sessions/Einladungen). Links einzeln widerrufen/neu ausstellen.
- [x] Verteilen per Kopieren, QR-Code oder - bei gesetztem `SMTP_HOST` - direkt per Mail.
- [x] Beteiligungsübersicht auf der Verwaltungsseite ("7 von 12 haben abgestimmt", wer fehlt).
- [x] Option "nur Teilnahme speichern, nicht wer was gewählt hat". README: ehrliche Grenze dokumentieren
      (wer verteilt, kennt die Zuordnung Link → Person).

### A2. E-Mail-Bestätigung (Magic Link)

- [x] Offene Abstimmung, vor dem Abstimmen Bestätigungslink an die eigene Adresse (braucht SMTP).
- [x] Optional Domain-Allowlist (z.B. nur `@verein.de`) oder feste Adressliste.
- [x] Adressen per `normalizeEmail` vereinheitlichen, Anfragen über `app/lib/throttle.ts` drosseln
      (sonst Mailschleuder).

### A3. Mit Konto abstimmen

- [x] Mit lokalem Konto bzw. Suite-Konto abstimmen (Sessions/Verbund existieren schon).
- [x] Erweiterung auf **Teilnehmendenkonten** aus dem Suite-Verbund, siehe Abschnitt D1.

### A4. Zugangscode pro Abstimmung

- [x] Optionaler Code/PIN, mit jedem Modus kombinierbar. In der Oberfläche klar sagen: hält Fremde fern,
      verhindert keine Mehrfachabstimmung.

### A5. Hürden für den Cookie-Modus

- [x] Drosselung beim Abstimmen pro IP-Hash und Abstimmung (`LoginThrottle` wiederverwenden), großzügig wegen NAT
      (z.B. 30 neue Identitäten/Stunde). Schließt die README-Grenze "Kein Rate-Limiting beim Abstimmen".
- [x] Optionales Pflicht-Namensfeld (Namen im Ergebnis sichtbar → soziale Kontrolle).
- [x] Optionale Höchstzahl an Teilnehmenden.

---

## B. Mehr Möglichkeiten beim Abstimmen

- [x] **Sichtbarkeit der Ergebnisse:** immer live (heute) / erst nach eigener Stimme / erst nach Schließung /
      nur Verwaltung. Betrifft `app/[pollId]/page.tsx`, `poll-results.tsx`.
- [x] **Grenzen bei der Mehrfachauswahl:** `minChoices`/`maxChoices` ("wähle 1 bis 3").
- [x] **Neue Abstimmungsarten** (größter Umbau: `Vote` braucht Wert/Gewicht, `PollResults` je Art eigene
      Auswertung):
  - [x] Ja / Vielleicht / Nein pro Option (Doodle-Stil)
  - [x] Rangfolge (Borda oder Instant-Runoff)
  - [x] Punkte verteilen (z.B. 10 Punkte auf beliebige Optionen)
  - [x] **[rsvp-app]** Folgepunkt: Die Ergebnis-Meldung schickt bei anderen Arten die Wertung als `votes`, rsvp-app
        schreibt dazu "Stimmen". Vertrag um die Art/Einheit erweitern (z.B. `unit: "votes" | "points"`).
- [x] **Terminoptionen:** Optionen als Datum/Uhrzeit mit Kalender-Eingabe statt Freitext.
- [x] **Terminabstimmung → rsvp-app** **[rsvp-app]**: Das Endergebnis legt in rsvp-app ein Event an bzw. gibt
      einem bestehenden Event sein endgültiges Datum.
  - Baut auf der bestehenden Ergebnis-Meldung auf (`app/lib/rsvp-notify.ts`); Vertrag um das Gewinner-Datum
    erweitern, rsvp-app braucht einen Endpunkt dafür und einen Zustand "Datum noch offen".
  - **Entschieden (2026-09-30):**
    - Nie vollautomatisch: Eindeutiges Ergebnis → das Verwaltungskonto **bestätigt** nur. Gleichstand → das
      Verwaltungskonto **entscheidet** zwischen den gleichauf liegenden Terminen.
    - Neues Event nur, wenn der Owner der Abstimmung ein verknüpftes rsvp-app-Konto hat (Suite-Verbund) - ihm
      gehört das Event dann. Ohne Verknüpfung nur "bestehendem Event das Datum geben".
    - Benachrichtigungen:
      1. Offene Entscheidung/Bestätigung → an das Verwaltungskonto (Push, wenn verfügbar; sonst Mail).
      2. Nach Festlegung → an alle Abstimmenden und an die Gäste des Events (Push, wenn verfügbar; sonst Mail).
    - (Nachtrag 2026-09-30) Bestätigt/entschieden wird im Abstimmungstool, rsvp-app bekommt nur das Datum. Push
      nur mit Konto (Abstimmende ohne Konto per Mail, im Cookie-Modus niemand). rsvp-app durfte angepasst werden.
  - Umgesetzt: Abstimmungstool `app/lib/final-date.ts`, `app/lib/rsvp-date.ts` (Abschnitt "Terminabstimmung" im
    README); rsvp-app `Event.datePending`, `POST /api/poll-date`, `app/lib/poll-date.ts`. Doppel-Benachrichtigungen:
    SHA-256-Hashes der Adressen, die das Abstimmungstool selbst benachrichtigt. Push-Grundlage siehe C.
- [x] **Optionen von Teilnehmenden:** Vorschläge ergänzen, optional erst nach Freigabe durch die Verwaltung.

---

## C. Verwaltung & Komfort

- [x] CSV-Export der Ergebnisse auf der Verwaltungsseite.
- [x] QR-Code zum Abstimmungslink.
- [x] Abstimmung duplizieren / als Vorlage nutzen (wiederkehrende Runden).
- [x] Mail an die Erstellerin/den Ersteller beim Schließen mit Ergebnis (manuell und per Cron
      `app/api/cron/close-expired-polls`).
- [x] Quorum / Mindestbeteiligung: Ergebnis erst ab N Stimmen gültig, sonst "nicht beschlussfähig".
  - [x] **[rsvp-app]** Folgepunkt: rsvp-app kennt "nicht beschlussfähig" nicht (leere Gewinnerliste heißt dort
        "keine Stimme abgegeben"). Bis dahin meldet dieses Tool ein verfehltes Quorum gar nicht. Vertrag um ein
        Feld wie `quorumMet` erweitern und `app/ui/poll-result-banner.tsx` in rsvp-app anpassen.
- [x] Web-Push-Benachrichtigungen als Grundlage (für die Terminabstimmung unter B, aber auch z.B. "Abstimmung
      geschlossen"). Löst die bisherige Entscheidung "keine Push-Benachrichtigungen" ab - README und
      Datenschutzerklärung (Push-Abos sind personenbezogen) anpassen.
  - Umgesetzt für Konten ("Abstimmung beendet"), ohne Zusatzpaket. Noch offen: Push für Abstimmende ohne
    Konto - hängt an der Terminabstimmung (Abschnitt B), dort erst entscheiden.

---

## E. Live-Abstimmungsmodus wie bei Kahoot (neu 2026-10-04)

Eigene Art neben der Abstimmung: eine **Live-Runde** mit mehreren Fragen, die die Verwaltung im Raum auf einer
Leinwand Frage für Frage vorführt, während alle auf dem Handy antworten.

- [x] Anlegen/Bearbeiten: Titel, Fragen mit 2-6 Antworten, Zeitlimit je Frage (oder ohne), optional richtige
      Antwort(en) markieren → Quizfrage mit Punkten, sonst reine Umfragefrage. Bearbeiten nur, solange noch niemand
      geantwortet hat.
- [x] Beitritt ohne Konto: 6-stellige PIN auf `/live` (oder QR-Code mit vorausgefüllter PIN) + Spitzname. Cookie
      pro Runde (nur Hash in der DB), Spitznamen eindeutig. PIN-Raten und Massen-Beitritte drosseln.
- [x] Präsentationsansicht (Leinwand): Lobby mit PIN, QR-Code und Teilnehmenden (entfernen, Beitritt sperren) →
      Frage mit Countdown und "x von y haben geantwortet" → Auflösung (Verteilung, richtige Antwort) → Rangliste →
      … → Siegertreppchen. Die Verwaltung schaltet weiter, Zeitablauf oder "alle haben geantwortet" lösen auf.
- [x] Teilnehmendenansicht: farbige Antwortknöpfe (Kahoot-Formen), erste Antwort zählt, danach eigenes Ergebnis,
      Punkte und Platz.
- [x] Punkte wie bei Kahoot: richtig = 500-1000 je nach Schnelligkeit (ohne Zeitlimit 1000), falsch = 0.
- [x] Echtzeit ohne Zusatzdienst: Long-Polling auf einen Route Handler (wacht über ein prozessinternes Signal sofort
      auf, prüft sonst alle 2 s die DB) - funktioniert hinter Cloudflare/Nginx ohne Sonderkonfiguration.
- [x] Ergebnisse danach auf der Verwaltungsseite, "Neu starten" (Teilnehmende/Antworten löschen, neue PIN), Löschen,
      Löschfristen wie bei Abstimmungen. README und Datenschutzerklärung (Spitzname, Antworten, Antwortzeit, Cookie).
- Umgesetzt (2026-10-04): `app/lib/live.ts`, `app/live-actions.ts`, `app/api/live/[id]/route.ts`, Seiten unter
  `app/live/`, Tests `tests/e2e/live.spec.ts`, README-Abschnitt "Live-Runden".
- [ ] Ideen für später: Live-Runde mit anderen Konten teilen (wie `PollAccess`), CSV-Export der Ergebnisse,
      weitere Fragearten (Mehrfachauswahl, Schätzfrage, Wortwolke), Bilder zu Fragen.

---

## D. Suite-Verbund **[suite-kit] [rsvp-app]**

**Besprochen und entschieden (2026-10-04)** - gilt vor den Einzelpunkten darunter, wo sie abweichen:
- **D1 wird gebaut, schlank:** zunächst nur rsvp-app (Anbieter) → Abstimmungstool (Empfänger, Modus `ACCOUNT`).
  - Statt eines Felds `kind` ein **eigener Bestätigungstyp** (z.B. `typ: suite-participant+v1`): Ein Tool mit älterer
    suite-kit-Version würde ein unbekanntes Feld ignorieren und das Konto als Verwaltungskonto anlegen (bei
    `autoProvision` sogar als Creator) - einen unbekannten Typ lehnt es ab (fail-closed).
  - Empfänger: eigene Tabelle und eigenes Sitzungs-Cookie für Teilnehmende, nie `User`/`Session`.
  - Nur `GuestUser.isVerified`; übertragen werden **paarweise Kennung** (`sub` = HMAC über Empfänger + Konto-ID) und
    Name, **keine E-Mail**. rsvp-app zeigt beim ersten Mal pro Tool, was übertragen wird, und merkt sich die Zustimmung.
  - RSVP-Token und Webhook bleiben parallel (Gäste ohne Konto haben nur diesen Weg).
- **Schalter nur in der Env** (keine Settings-Tabelle): Anbieter-Liste der Tools, die Teilnehmende bekommen; Empfänger
  `participants: true` je Eintrag in `SUITE_IDPS`. Abschalten beendet Teilnehmenden-Sitzungen sofort, Stimmen bleiben
  gezählt.
- **Löschung/Sperre beim Anbieter:** kein Webhook, sondern **kurze Sitzungen** für föderierte Teilnehmende (ca. 24 h),
  danach erneute Anmeldung über rsvp-app.
- **D2 in allen vier Tools** (rsvp-app, Abstimmungstool, Seating, Zeitplan) und im suite-kit-README.
- **D3:** Single Logout bewusst nicht (dokumentieren). Löschfrist für föderierte Teilnehmende wie suite-weit (2 Jahre
  ohne Anmeldung, Stimmen bleiben ohne Namen gezählt). Tool-Umschalter wandert nach `suite-kit/docs/IDEEN.md` P2
  (gemeinsame Startseite, `SUITE_HOME_URL`). Schlüsselwechsel (`SUITE_SIGNING_KEY_PREVIOUS` gibt es schon) nur
  dokumentieren und testen.
- **Reihenfolge:** D2 und Schlüsselwechsel zuerst (unabhängig, risikoarm), dann D1.

### D1. Teilnehmendenkonten im Verbund teilen

Idee: Neben den Verwaltungskonten (Rollen Admin/Creator/Moderator) auch die **Nutzer-Konten** aus rsvp-app
(`GuestUser`) im Verbund nutzbar machen, z.B. für A3. Admins schalten das pro Tool an/aus.

- [x] **Kontoart im Protokoll:** Die signierte Bestätigung braucht ein Feld wie `kind: "staff" | "participant"`.
      Der Empfänger darf ein Teilnehmendenkonto **nie** auf eine Verwaltungsrolle abbilden - Teilnehmende landen
      in einer eigenen Tabelle (z.B. `Participant`), nicht in `User`, damit eine Teilnehmenden-Sitzung
      strukturell keine Verwaltungsrechte haben kann.
- [x] **Schalter an zwei Stellen:** Anbieter ("Teilnehmendenkonten für andere Tools freigeben") und Empfänger
      ("Anmeldung mit Teilnehmendenkonten annehmen"). Vorschlag: Vertrauen/Schlüssel bleiben in der Env
      (`SUITE_IDPS`, `SUITE_TRUSTED_APPS`), der fachliche An/Aus-Schalter kommt als Admin-Einstellung in die
      Oberfläche (neue Settings-Tabelle). Klären, was bei Deaktivierung mit bestehenden Sitzungen/Stimmen passiert.
- [x] **Nur verifizierte Konten bestätigen:** rsvp-app stellt Bestätigungen nur für `GuestUser.isVerified` aus.
- [x] **Datenminimierung & Einwilligung:** Beim ersten Login zeigen, was übertragen wird. Nur Konto-ID und ggf. Name
      übertragen, E-Mail nur wenn nötig. Datenschutzerklärungen beider Tools anpassen (Übermittlung zwischen Tools).
- [x] **Paarweise Kennungen (Pseudonyme):** Für Teilnehmende pro Empfänger-Tool eine eigene `subject`-ID
      ausstellen, damit Tools die Personen nicht untereinander verknüpfen können (Privacy by Design).
- [x] **Verhältnis zum RSVP-Token:** Wenn Teilnehmendenkonten föderiert sind, ist der Modus `RSVP` im Kern
      "Konto + Bedingung Zusage". Entscheiden: zwei Mechanismen parallel behalten oder den Klick-Token
      (`RSVP_VERIFICATION_SECRET`) in den Verbund überführen - der Webhook für Absagen bleibt so oder so nötig.
- [x] Dieselbe Person mit Verwaltungs- **und** Teilnehmendenkonto: bewusst getrennt halten, keine Zusammenführung.

Umgesetzt (2026-10-04) nach den Entscheidungen oben: suite-kit v0.2.0 (`suite-participant+v1`, `kind=participant`,
`SUITE_PARTICIPANT_APPS`, `participants` in `SUITE_IDPS`); rsvp-app `GuestToolConsent`, Zustimmungsseite
`/mein-konto/freigabe`, Entzug in den Konto-Einstellungen; Abstimmungstool `Participant`/`ParticipantSession`
(24 h), `app/lib/participant.ts`, Knopf im Modus `ACCOUNT`. Paarweise Kennung zufällig statt HMAC (gespeichert mit der
Zustimmung - kein weiteres Secret, unabhängig von Schlüsselwechseln). RSVP-Token und Webhook bleiben parallel. Tests:
suite-kit `test/participant.test.ts`, rsvp-app `suite-participant.spec.ts`, hier `participant.spec.ts`; einmal beide
Apps echt gegeneinander.

### D2. Wording vereinheitlichen (alle Tools)

Problem: "Admin-Konten" meint in rsvp-app alle Verwaltungskonten (inkl. Creator/Moderator, Login unter
`/admin/login`), gleichzeitig ist "Admin" eine Rolle. Vorschlag:

- **Verwaltungskonto** = Konto mit Rolle Admin, Creator oder Moderator (Code: `User`).
- **Teilnehmendenkonto** = Konto für Gäste/Abstimmende ohne Verwaltungsrechte (rsvp-app: `GuestUser`,
  bisher "Nutzer-Konto").
- **Admin** nur noch als Rollenname ("Konto mit Admin-Rolle"), nie als Kontoart.
- [x] Begriffe in allen READMEs, UI-Texten und Datenschutzerklärungen umstellen; Code-Bezeichner dürfen bleiben.
      (2026-10-04, alle vier Tools: "Verwaltung" statt "Admin-Dashboard", Kontenliste "Konten", "Konto mit Admin-Rolle".)
- [x] suite-kit-README anpassen: Abschnitt "Begriffe"; der Satz zur Föderation nennt Teilnehmendenkonten als geplant
      (nach D1 nochmals anpassen).

### D3. Weitere Punkte für später

- [x] **Konto-Löschung/Sperre weitergeben:** entschieden: kurze Sitzungen (Umsetzung mit D1), dokumentiert in
      suite-kit `docs/PROTOCOL.md` "Bewusst nicht enthalten". Wird ein Konto beim Anbieter gelöscht, weiß der Empfänger nichts
      davon. Webhook zur Weitergabe oder kurze Sitzungsdauer für föderierte Konten?
- [x] **Abmelden in allen Tools (Single Logout):** bewusst nicht, dokumentiert (suite-kit README und `docs/PROTOCOL.md`).
- [x] **Löschfristen für föderierte Teilnehmendenkonten** im Empfänger (Cleanup-Cron): 2 Jahre ohne Anmeldung,
      Stimmen bleiben ohne Namen gezählt (mit D1 umgesetzt).
- [x] ~~**Tool-Umschalter**~~ verschoben nach suite-kit `docs/IDEEN.md` P2 (gemeinsame Startseite).
- [x] **Schlüsselwechsel** für `SUITE_SIGNING_KEY`: Ablauf in suite-kit `docs/PROTOCOL.md` (geplant und Notfall), Tests
      `test/rotation.test.ts` (suite-kit) und "Schlüsselwechsel beim Anbieter" (`tests/e2e/suite.spec.ts`).
