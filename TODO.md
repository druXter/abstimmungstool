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
- [ ] Erweiterung auf **Teilnehmendenkonten** aus dem Suite-Verbund, siehe Abschnitt D.

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
- [ ] **Neue Abstimmungsarten** (größter Umbau: `Vote` braucht Wert/Gewicht, `PollResults` je Art eigene
      Auswertung):
  - [ ] Ja / Vielleicht / Nein pro Option (Doodle-Stil)
  - [ ] Rangfolge (Borda oder Instant-Runoff)
  - [ ] Punkte verteilen (z.B. 10 Punkte auf beliebige Optionen)
- [x] **Terminoptionen:** Optionen als Datum/Uhrzeit mit Kalender-Eingabe statt Freitext.
- [ ] **Terminabstimmung → rsvp-app** **[rsvp-app]**: Das Endergebnis legt in rsvp-app ein Event an bzw. gibt
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
  - Offen/zu beachten:
    - Push gibt es bisher bewusst nicht (README, Abschnitt PWA) - braucht Web Push (VAPID-Schlüssel,
      Push-Abos pro Konto/Gerät, Service Worker `public/sw.js` erweitern) in beiden Tools. Mail als Fallback.
    - Abstimmende sind nur erreichbar, wenn eine Kontaktmöglichkeit existiert (Modi `EMAIL`, `ACCOUNT`, `RSVP`,
      `LINK` mit hinterlegter Mail, oder Push-Abo). Im Cookie-Modus ist niemand benachrichtigbar - in der
      Oberfläche so kennzeichnen.
    - Wo wird bestätigt/entschieden - in rsvp-app oder im Abstimmungstool? Vorschlag: im Abstimmungstool
      (dort liegt das Ergebnis), rsvp-app bekommt nur das endgültige Datum.
    - Gäste des Events benachrichtigt rsvp-app selbst (dort liegen die Kontakte), das Abstimmungstool nur
      die Abstimmenden - Doppel-Benachrichtigungen bei Personen, die beides sind, vermeiden.
- [ ] **Optionen von Teilnehmenden:** Vorschläge ergänzen, optional erst nach Freigabe durch die Verwaltung.

---

## C. Verwaltung & Komfort

- [x] CSV-Export der Ergebnisse auf der Verwaltungsseite.
- [x] QR-Code zum Abstimmungslink.
- [x] Abstimmung duplizieren / als Vorlage nutzen (wiederkehrende Runden).
- [x] Mail an die Erstellerin/den Ersteller beim Schließen mit Ergebnis (manuell und per Cron
      `app/api/cron/close-expired-polls`).
- [x] Quorum / Mindestbeteiligung: Ergebnis erst ab N Stimmen gültig, sonst "nicht beschlussfähig".
  - [ ] **[rsvp-app]** Folgepunkt: rsvp-app kennt "nicht beschlussfähig" nicht (leere Gewinnerliste heißt dort
        "keine Stimme abgegeben"). Bis dahin meldet dieses Tool ein verfehltes Quorum gar nicht. Vertrag um ein
        Feld wie `quorumMet` erweitern und `app/ui/poll-result-banner.tsx` in rsvp-app anpassen.
- [ ] Web-Push-Benachrichtigungen als Grundlage (für die Terminabstimmung unter B, aber auch z.B. "Abstimmung
      geschlossen"). Löst die bisherige Entscheidung "keine Push-Benachrichtigungen" ab - README und
      Datenschutzerklärung (Push-Abos sind personenbezogen) anpassen.

---

## D. Suite-Verbund (zum Besprechen, bevor gebaut wird) **[suite-kit] [rsvp-app]**

### D1. Teilnehmendenkonten im Verbund teilen
Idee: Neben den Verwaltungskonten (Rollen Admin/Creator/Moderator) auch die **Nutzer-Konten** aus rsvp-app
(`GuestUser`) im Verbund nutzbar machen, z.B. für A3. Admins schalten das pro Tool an/aus.
- [ ] **Kontoart im Protokoll:** Die signierte Bestätigung braucht ein Feld wie `kind: "staff" | "participant"`.
      Der Empfänger darf ein Teilnehmendenkonto **nie** auf eine Verwaltungsrolle abbilden - Teilnehmende landen
      in einer eigenen Tabelle (z.B. `Participant`), nicht in `User`, damit eine Teilnehmenden-Sitzung
      strukturell keine Verwaltungsrechte haben kann.
- [ ] **Schalter an zwei Stellen:** Anbieter ("Teilnehmendenkonten für andere Tools freigeben") und Empfänger
      ("Anmeldung mit Teilnehmendenkonten annehmen"). Vorschlag: Vertrauen/Schlüssel bleiben in der Env
      (`SUITE_IDPS`, `SUITE_TRUSTED_APPS`), der fachliche An/Aus-Schalter kommt als Admin-Einstellung in die
      Oberfläche (neue Settings-Tabelle). Klären, was bei Deaktivierung mit bestehenden Sitzungen/Stimmen passiert.
- [ ] **Nur verifizierte Konten bestätigen:** rsvp-app stellt Bestätigungen nur für `GuestUser.isVerified` aus.
- [ ] **Datenminimierung & Einwilligung:** Beim ersten Login zeigen, was übertragen wird. Nur Konto-ID und ggf. Name
      übertragen, E-Mail nur wenn nötig. Datenschutzerklärungen beider Tools anpassen (Übermittlung zwischen Tools).
- [ ] **Paarweise Kennungen (Pseudonyme):** Für Teilnehmende pro Empfänger-Tool eine eigene `subject`-ID
      ausstellen, damit Tools die Personen nicht untereinander verknüpfen können (Privacy by Design).
- [ ] **Verhältnis zum RSVP-Token:** Wenn Teilnehmendenkonten föderiert sind, ist der Modus `RSVP` im Kern
      "Konto + Bedingung Zusage". Entscheiden: zwei Mechanismen parallel behalten oder den Klick-Token
      (`RSVP_VERIFICATION_SECRET`) in den Verbund überführen - der Webhook für Absagen bleibt so oder so nötig.
- [ ] Dieselbe Person mit Verwaltungs- **und** Teilnehmendenkonto: bewusst getrennt halten, keine Zusammenführung.

### D2. Wording vereinheitlichen (alle Tools)
Problem: "Admin-Konten" meint in rsvp-app alle Verwaltungskonten (inkl. Creator/Moderator, Login unter
`/admin/login`), gleichzeitig ist "Admin" eine Rolle. Vorschlag:
- **Verwaltungskonto** = Konto mit Rolle Admin, Creator oder Moderator (Code: `User`).
- **Teilnehmendenkonto** = Konto für Gäste/Abstimmende ohne Verwaltungsrechte (rsvp-app: `GuestUser`,
  bisher "Nutzer-Konto").
- **Admin** nur noch als Rollenname ("Konto mit Admin-Rolle"), nie als Kontoart.
- [ ] Begriffe in allen READMEs, UI-Texten und Datenschutzerklärungen umstellen; Code-Bezeichner dürfen bleiben.
- [ ] suite-kit-README anpassen ("Gäste ohne Konto … nehmen an der Konto-Föderation nicht teil" gilt dann nicht mehr).

### D3. Weitere Punkte für später
- [ ] **Konto-Löschung/Sperre weitergeben:** Wird ein Konto beim Anbieter gelöscht, weiß der Empfänger nichts
      davon. Webhook zur Weitergabe oder kurze Sitzungsdauer für föderierte Konten?
- [ ] **Abmelden in allen Tools (Single Logout):** gibt es nicht - bewusst so lassen oder nachrüsten?
- [ ] **Löschfristen für föderierte Teilnehmendenkonten** im Empfänger (Cleanup-Cron) festlegen.
- [ ] **Tool-Umschalter:** gemeinsames Menü, um zwischen verbundenen Tools zu wechseln (Discovery gibt es schon).
- [ ] **Schlüsselwechsel** für `SUITE_SIGNING_KEY` als Ablauf dokumentieren und testen.
