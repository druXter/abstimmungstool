# Oberfläche der Verwaltung – Konzept

Neugestaltung vom 2026-10-11, angelehnt an die Neugestaltung von rsvp-app (dort `docs/KONZEPT-OBERFLAECHE.md`).
Ziel: Wer beide Tools nutzt, findet sich sofort zurecht – gleiche Kopfzeile, gleiche Bausteine, gleicher Aufbau
„Übersicht → Seite mit Reitern → Einstellungen in Abschnitten“.

## Ausgangslage

* Die Verwaltungsseite einer Abstimmung war eine lange Spalte aus Karten: Link, QR-Code, sieben bunte Knöpfe mit
  Emojis (Bearbeiten, Schließen, CSV, Duplizieren, Löschen …), Termin, Vorschläge, Stimmlinks, Freigaben, Ergebnis –
  ohne Kennzahlen auf einen Blick und ohne Unterscheidung zwischen täglichem Gebrauch und Seltenem.
* „Meine Abstimmungen“ zeigte nur Titel, Datum und offen/geschlossen; was zu tun war (Termin festlegen, Vorschläge
  freigeben), war nicht zu sehen.
* Anlegen und Bearbeiten teilten ein langes Formular mit allen Einstellungen, ein amberfarbener Kasten für
  „Wer darf abstimmen?“ dazwischen.
* Kopfzeile nur als Textlinks rechts oben, Abmelden als eigener Link.

## Aufbau

| Seite | Inhalt |
| --- | --- |
| `/meine-abstimmungen` | Übersicht „Abstimmungen“: *Aktuell* (was zu tun ist zuerst, amber umrandet) und eingeklappt *Beendet*. Pro Eintrag Zahl der Teilnehmenden, Stand, Art, wer abstimmen darf, Merkmale (Termin festlegen, offene Vorschläge, Stimmlinks 3/5, freigegeben). Live-Runden in derselben Liste mit lila Themenmarke. Admins sehen alles mit Besitz. |
| `/[id]/verwalten` | Abstimmung mit Kopf (Titel, Art, Stand, Merkmale, „Abstimmungsseite ↗“, „Jetzt schließen“) und Reitern. **Übersicht**: Kennzahlen (Teilnehmende, Optionen bzw. Stimmlinks, Vorne/Ergebnis, Stand), Termin festlegen, Vorschläge, Ergebnis mit Namen und CSV, „Zum Abstimmen“ (Link mit Kopieren, QR-Code, Zugangscode). |
| `/[id]/verwalten/stimmlinks` | Nur im Modus „Persönliche Stimmlinks“: ausstellen, verteilen, Beteiligung. Ohne diesen Modus zurück zur Übersicht. |
| `/[id]/verwalten/bearbeiten` | **Einstellungen** (Pfad unverändert): ein Formular in einklappbaren Abschnitten mit Kurzstand – Grunddaten · Optionen · Art der Abstimmung · Wer darf abstimmen? · Ergebnis · Zugang und Teilnahme –, Speichern-Leiste unten sichtbar, nach dem Speichern bleibt man dort („Gespeichert.“). Darunter Gemeinsam moderieren (Owner), Duplizieren, Löschen (Owner). `?abschnitt=` öffnet einen Abschnitt. |
| `/erstellen` | Kurz anlegen: Frage, Beschreibung, Schließdatum, Vorlage, Optionen. Alles Weitere unter „Einstellungen“. |
| `/live/[id]/verwalten`, `/live/[id]/bearbeiten` | Live-Runde im selben Rahmen: Kopf mit „Leinwand öffnen“, Reiter Übersicht (Kennzahlen, Beitreten, Rangliste, Ergebnisse mit CSV, Freigaben, Neu starten, Löschen) und – solange niemand geantwortet hat – Fragen. |

Alt-Abstimmungen ohne Konto: Die Reiter tragen den Verwaltungs-Token weiter (`?token=`); die Seiten prüfen die
Berechtigung jeweils selbst (`loadManagedPoll` in `app/[pollId]/verwalten/poll-frame.tsx`), ein Layout gibt es dafür
bewusst nicht – es bekäme die Query nicht zu sehen.

## Vorlagen beim Anlegen

`app/lib/poll-presets.ts`, wie die Event-Arten in rsvp-app:

| Vorlage | Stellt ein | Danach |
| --- | --- | --- |
| Schnelle Umfrage (Standard) | Auswahl, offen für alle mit dem Link, Ergebnis live | Übersicht |
| Terminfindung | Ja/Vielleicht/Nein, Name verlangt und sichtbar, Termin nach dem Ende festlegen; die Optionen springen auf „Tage“ | Übersicht |
| Geheime Wahl | persönliche Stimmlinks, geheime Wahl, Ergebnis erst nach dem Ende | Stimmlinks |
| Ideen sammeln | Punkte verteilen (10), Vorschläge von Teilnehmenden mit Freigabe | Übersicht |

Allen gemeinsam: Ergebnis beim Schließen dem Konto mitteilen. Unbekannte Werte fallen auf die schnelle Umfrage zurück
(`Object.hasOwn`, auch bei `toString`).

## Gestaltung

* Dieselben Bausteine wie rsvp-app in `app/ui/kit.tsx` (Card, Badge, Stat, ButtonLink/buttonClass, SettingsSection,
  PageHeader, inputClass, Main). Hinweise weiter über `app/ui/notice.tsx` (gleiche Farben).
* Ruhig: weiß/grau, Blau nur für Hauptaktionen und den aktiven Reiter, keine Emojis an Knöpfen. Farbe trägt Bedeutung:
  grün offen, grau beendet, amber „braucht eine Entscheidung“ (Termin festlegen, Vorschläge, abgelaufen), rot
  nicht beschlussfähig, lila Live-Runde, türkis freigegeben.
* Kopfzeile auf allen Seiten (`app/ui/account-nav.tsx`): Marke, Navigation (Abstimmungen, bei Creator/Admin Konten),
  Konto-Menü (Mein Konto, Abmelden; schließt sich nach Seitenwechsel und Klick daneben). Ohne Anmeldung nur
  „Anmelden“. Beim Drucken ausgeblendet.
* Abstimmungsseite: Kopf mit Stand und Art, für Verwaltende ein Knopf „Verwalten“. Leinwand und Spieleransicht der
  Live-Runden bleiben dunkel und bunt wie bisher.
