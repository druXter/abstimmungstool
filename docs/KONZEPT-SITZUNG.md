# Konzept: Sitzungsmodus (Idee L7)

Stand: 2026-10-15. Idee L7 aus `suite-kit/docs/IDEEN.md`: Mitgliederversammlung, Fachschaftsrat, StuPa. Die Bausteine
der Suite werden verbunden: Tagesordnung (Zeitplan), Anwesenheit über den Check-in (rsvp-app), Abstimmungen nur für
Anwesende (hier), viele kurze Abstimmungen hintereinander, Beschlussfähigkeit live, Rednerliste, Protokoll.

**Grundsatz: Jeder Baustein ist einzeln schaltbar.** Es gibt keinen Schalter „Sitzungsmodus an“, sondern Optionen, die
sich frei kombinieren lassen:

| Baustein | Wo | Schalter |
| --- | --- | --- |
| Kommen und Gehen mit Uhrzeit, Reiter „Anwesenheit“ | rsvp-app | Termin: „Kommen und Gehen protokollieren“ (braucht QR-Einlass) |
| Sitzung mit schnellen Abstimmungen | Abstimmungstool | eine Sitzung anlegen; mit rsvp-app nur, wenn ein Termin sie verlinkt |
| Abstimmen nur für Anwesende | Abstimmungstool | Sitzung: „Nur Anwesende stimmen ab“ (sonst alle Zusagen) |
| Geheim oder namentlich | Abstimmungstool | pro Abstimmung, Vorgabe pro Sitzung |
| Beschlussfähigkeit live | Abstimmungstool | Sitzung: „Beschlussfähig ab N Anwesenden“ (leer = keine Anzeige) |
| Rednerliste | Abstimmungstool | Sitzung: „Rednerliste“ |
| Protokoll (Anwesenheit, Beschlüsse, Tagesordnung) | Zeitplan, rsvp-app, hier | je eigene Exporte; Zusammenführung im Zeitplan-Rückblick optional |

## 1. Anwesenheit (rsvp-app, umgesetzt)

`Event.trackPresence`: Auschecken heißt „geht“. `Rsvp.leftAt`/`RsvpPerson.leftAt` halten fest, seit wann jemand weg
ist, `hasAttended` bleibt („war da“). Jeder Wechsel landet in `PresenceEntry` (Name, Zeitpunkt, IN/OUT). Ein erneuter
Scan checkt Gegangene wieder ein, „Letzte Änderung zurücknehmen“ korrigiert Fehlscans. Reiter „Anwesenheit“ mit
Aufenthalten pro Person, Verlauf, Druck und CSV. Details: `rsvp-app/app/lib/checkin.ts`.

## 2. Sitzung im Abstimmungstool

Neues Modell `Assembly` („Sitzung“), daneben `Poll`, `LiveSession`, `Survey`. Eine Sitzung bündelt Abstimmungen
(`Poll.assemblyId`, Identität `ASSEMBLY`) und kennt ihre Mitglieder (`AssemblyMember`).

### Mitglieder: nur über rsvp-app

Ein Termin in rsvp-app verlinkt die Sitzung (`Event.assemblyUrl` = `<Abstimmungstool>/sitzung/<id>`). Gäste mit einer
Zusage, die zählt, sehen auf ihrer Seite „🗳️ Zur Sitzung“. rsvp-app leitet über `/api/assembly-link/<eventId>` mit
einem frisch signierten Nachweis weiter auf `/sitzung/<id>/beitreten?verify=…`. Das Abstimmungstool legt das Mitglied
an bzw. aktualisiert es und setzt ein eigenes Cookie (`assembly_<id>`, zufälliges Token, in der Datenbank nur der
Hash). Ein Beitritt von einem zweiten Gerät meldet das erste ab (ein Token pro Mitglied).

Das Mitglied heißt so, wie es in rsvp-app angemeldet ist (für Rednerliste und namentliche Abstimmungen); erkannt wird
es an einem Pseudonym `sub` = HMAC(Secret, Sitzung, Rsvp-ID). Keine E-Mail, keine Rsvp-ID.

### Anwesenheit: bei jeder Stimme frisch aus rsvp-app

Das Abstimmungstool fragt rsvp-app (`POST /api/assembly/roster`, signiert), wer gerade da ist: Antwort ist die Liste
der Pseudonyme der Anwesenden, die Zahl der Zusagen und ob der Termin QR-Einlass hat (ebenfalls signiert). Kurz
zwischengespeichert (5 Sekunden), bei jeder Stimmabgabe geprüft. **Fail closed:** Ist rsvp-app nicht erreichbar,
gilt niemand als anwesend - die Seite sagt das. Wer geht, kann danach nicht mehr abstimmen; abgegebene Stimmen
bleiben (sie wurden als Anwesende abgegeben).

Ohne „Nur Anwesende stimmen ab“ dürfen alle Mitglieder abstimmen (wer beigetreten ist, hatte eine Zusage).

### Verknüpfung absichern

Die Sitzung merkt sich den Termin (`Assembly.rsvpEventId`), sobald rsvp-app sie zum ersten Mal meldet - beim
Speichern des Links (`POST /api/rsvp-assembly`, Nachricht `assembly-link`) oder spätestens beim ersten Beitritt.
Danach nimmt sie nur noch Nachweise dieses Termins an; ein anderer Termin bekommt „schon mit einem anderen Termin
verknüpft“. Die Verwaltung sieht den Termin und kann die Verknüpfung lösen (Mitglieder werden dabei entfernt).
rsvp-app beantwortet die Anwesenheit nur für einen Termin, der genau diese Sitzung verlinkt.

### Nachrichten (gleiches Format und Secret wie die übrige Kopplung, immer mit `typ`)

| typ | Richtung | Payload | gültig |
| --- | --- | --- | --- |
| `assembly-access` | rsvp-app → Browser → `/sitzung/<id>/beitreten?verify=` | `assemblyId, eventId, sub, name, exp` | ≤ 15 min |
| `assembly-link` | rsvp-app → `POST /api/rsvp-assembly` | `assemblyId, eventId, eventTitle, exp` | ≤ 5 min |
| `assembly-roster` | Abstimmungstool → `POST <rsvp-app>/api/assembly/roster` | `assemblyId, eventId, exp` | ≤ 5 min |
| `assembly-roster-result` | Antwort darauf | `assemblyId, eventId, checkin, members, present: sub[], exp` | ≤ 5 min |

### Abstimmen

- **Geheim** (Vorgabe): Die Stimme hängt an einem Schlüssel aus Cookie-Token und Abstimmung, den die Datenbank nie
  sieht (wie die geheime Wahl mit Stimmlinks). Gespeichert wird getrennt nur, *dass* das Mitglied abgestimmt hat
  (`AssemblyBallot`). Wer nach der Stimme von einem anderen Gerät beitritt, kann die Stimme nicht mehr ändern und
  auch nicht noch einmal abstimmen.
- **Namentlich:** Schlüssel ist das Mitglied, die Verwaltung sieht, wer wie gestimmt hat (Protokoll).
- Ergebnis standardmäßig erst nach dem Schließen sichtbar; beim Schließen hält die Abstimmung fest, wie viele
  anwesend waren und ob die Sitzung beschlussfähig war (`Poll.assemblyPresent`, `Poll.assemblyQuorumMet`).

### Wenig Klicks

Verwaltung `/sitzung/<id>/verwalten`: oben Anwesenheit und Beschlussfähigkeit, darunter „Neue Abstimmung“ mit Titel
und Art (Ja/Nein/Enthaltung oder Wahl mit Optionen, eine pro Zeile), sofort offen; offene Abstimmungen mit Zahl der
Stimmen und „Schließen“, darunter die Ergebnisse. Mitglieder `/sitzung/<id>`: die offenen Abstimmungen direkt mit
Stimmzettel, aktualisiert sich von selbst (die Sitzung zählt bei jeder Änderung `version` hoch).

## 3. Beschlussfähigkeit

`Assembly.quorum`: beschlussfähig ab N Anwesenden. Angezeigt in Verwaltung und Mitgliederansicht („12 anwesend ·
beschlussfähig ab 11“), festgehalten bei jedem Beschluss. Die Zahl der Anwesenden kommt aus rsvp-app; ohne
„Kommen und Gehen“ zählt dort jeder Eingecheckte bis zum Ende.

## 4. Rednerliste

`Assembly.speakerList`. Mitglieder melden sich zu Wort („Wortmeldung“) oder mit einem Antrag zur Geschäftsordnung
(„GO-Antrag“, kommt vor alle Wortmeldungen) und können zurückziehen. Die Sitzungsleitung ruft auf („dran“) und
schließt ab. Nur wer abstimmen dürfte, kann sich melden (mit „Nur Anwesende“ also nur Anwesende).

## 5. Protokoll

- rsvp-app: Anwesenheit (Reiter, CSV) - wer wann kam und ging.
- Abstimmungstool: Beschlüsse der Sitzung als CSV (Zeit, Titel, Ergebnis, anwesend, beschlussfähig, bei namentlich die
  Namen).
- Zeitplan: Rückblick mit Ist-Zeiten und Protokollnotizen je Tagesordnungspunkt (L24). Die Zusammenführung (Kommen,
  Gehen und Beschlüsse an der Stelle der Tagesordnung, an der sie passiert sind) ist der letzte Schritt.

## Datenschutz

rsvp-app gibt nur Pseudonym und Namen der Zusage weiter, keine E-Mail. Das Abstimmungstool speichert Mitglieder mit
Namen, solange es die Sitzung gibt; geheime Stimmen lassen sich keinem Mitglied zuordnen. Beide Datenschutzerklärungen
beschreiben das.
