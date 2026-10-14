# Fragebogen – Konzept

Umsetzung von Idee L8 aus `suite-kit/docs/IDEEN.md` (2026-10-14). Anlass: ein Feedback-Fragebogen, der sich per iFrame
in andere Apps einbetten lässt – zuerst die Campus-App (`campus-koblenz.app`, dort heute Nextcloud Forms), später
weitere Apps unter `*.ramonroeser.de`.

## Abgrenzung

Eine Abstimmung (`Poll`) hat genau eine Frage und einen Gewinner; Quorum, Termin festlegen, Ergebnis an rsvp-app und
`Vote` (eindeutig über `pollId, voterKey, optionId`, ohne Text) bauen darauf auf. Ein Fragebogen hat mehrere Fragen
verschiedener Art und keinen Gewinner. Deshalb ein **eigenes Modell** neben `Poll` und `LiveSession`, nach dem Vorbild
der Live-Runden (eigene Actions, eigener Editor, gleiche Verwaltung mit Reitern).

## Datenmodell

| Modell | Inhalt |
| --- | --- |
| `Survey` | Titel, Beschreibung, Danke-Text, wer antworten darf (`SurveyIdentity`), Schließdatum/geschlossen, Besitz |
| `SurveyAccess` | gemeinsam verwalten (wie `LiveAccess`) |
| `SurveyQuestion` | Position, Text, Hinweis, Art (`SurveyQuestionKind`), Pflicht; Skala: von/bis und Beschriftung der Enden; Freitext: mehrzeilig |
| `SurveyOption` | Antwortmöglichkeiten bei Einfach-/Mehrfachauswahl |
| `SurveyResponse` | eine ausgefüllte Runde; `voterKey` nur im Modus `COOKIE` (eindeutig pro Fragebogen), sonst leer |
| `SurveyAnswer` | Antwort auf eine Frage: gewählte Option (eine Zeile je Option), Text oder Zahl |

Fragearten: **Einfachauswahl** (Radiobuttons), **Mehrfachauswahl** (Checkboxen, optional höchstens n), **Freitext**
(einzeilig bis 300 Zeichen, mehrzeilig bis 2000) und **lineare Skala** (von 0 oder 1 bis 2–10, Beschriftung links/rechts).

## Wer antworten darf

| Modus | Verhalten | Einbettung |
| --- | --- | --- |
| `ANONYMOUS` (Standard) | jede Abgabe ist eine neue Antwort, nichts im Browser gespeichert; gedrosselt pro IP und Fragebogen | überall |
| `COOKIE` | eine Antwort pro Gerät (Cookie `voter_token` wie bei Abstimmungen), änderbar bis zum Ende | nur direkt oder unter derselben Domain (`*.ramonroeser.de`) |

Hintergrund: In einem iFrame einer *anderen* Website (Campus-App) ist `voter_token` ein Drittanbieter-Cookie, das
Browser nicht mitschicken bzw. blockieren. Die eingebettete Seite prüft im Modus `COOKIE` deshalb im Browser, ob sie
ein Cookie setzen kann, und bietet sonst an, den Fragebogen in einem neuen Tab zu öffnen. Weitere Modi (persönliche
Links, rsvp-app, Konto) lassen sich später über `resolveVoter` anschließen – das ist der zweite Teil von L8.

## Einbetten

* `/fragebogen/<id>` – normale Seite mit Kopfzeile, `/fragebogen/<id>/einbetten` – ohne Kopf- und Fußzeile, mit
  transparentem Hintergrund, meldet ihre Höhe per `postMessage` (`{ type: 'abstimmungstool:hoehe', id, height }`) an
  die einbettende Seite.
* **Nur diese Route** darf in fremden Seiten erscheinen. `proxy.ts` setzt dort zur Laufzeit
  `frame-ancestors 'self' <EMBED_ALLOWED_ORIGINS>`; die allgemeine Regel in `next.config.ts` (`frame-ancestors 'none'`,
  `X-Frame-Options: DENY`) nimmt die Route aus. Laufzeit statt Build, weil die `.env` nicht im Docker-Image liegt.
  Ohne `EMBED_ALLOWED_ORIGINS` nur `'self'`.
* Die einbettende App braucht `frame-src` mit der Adresse des Tools in ihrer eigenen CSP.
* Die Verwaltung zeigt den fertigen iFrame-Schnipsel samt Skript für die Höhe.

## Verwaltung

Wie Live-Runden (`docs/KONZEPT-OBERFLAECHE.md`): Eintrag in „Abstimmungen“ mit eigener Themenmarke (indigo), Kopf
mit „Fragebogen öffnen ↗“ und „Jetzt schließen“/„Wieder öffnen“, Reiter **Übersicht** (Kennzahlen, Link, QR-Code,
Einbetten, Auswertung je Frage, CSV) und **Bearbeiten** (Grunddaten jederzeit; Fragen nur, solange es keine Antworten
gibt – sonst passten Antworten nicht mehr zu den Fragen. „Alle Antworten löschen“ gibt die Fragen wieder frei).

Auswertung: Auswahl als Anteil der Antwortenden der Frage, Skala als Verteilung mit Durchschnitt und Median,
Freitext als Liste. Ergebnisse sieht nur die Verwaltung.

## Später

* Weitere Identitäten (L8 Teil 2): rsvp-app schickt nach dem Event den Link an Eingecheckte, Identität `RSVP`.
* Englische Oberfläche der eingebetteten Seite (Campus-App ist zweisprachig), z. B. per `?lang=en`.
* Weitere Fragearten (Dropdown, Datum, Matrix), bedingte Fragen, Fragen nachträglich ändern trotz Antworten.
