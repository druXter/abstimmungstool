// app/lib/mail.ts
import { renderMail } from 'suite-kit/web'

type RenderedMail = ReturnType<typeof renderMail>
import nodemailer from 'nodemailer'

// Gleicher Transporter-Aufbau wie in rsvp-app - falls beide Tools auf demselben
// Mailbox.org-Postfach laufen, deckt der dort bereits abgeschlossene AVV auch diesen
// zweiten, unabhängigen Versand ab (gleicher Auftragsverarbeiter, kein neuer Vertrag
// nötig). SMTP_HOST bewusst nicht vorausgesetzt: bleibt es leer, bricht der Versand
// unten früh ab statt einen kaputten Transporter zu nutzen. Die Konto-Funktionen
// funktionieren dann trotzdem - Einladungs-/Reset-Links werden dem einladenden Konto
// direkt auf dem Bildschirm angezeigt (siehe app/nutzer/page.tsx).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export function isMailConfigured(): boolean {
  return !!process.env.SMTP_HOST
}

/** Marke im Kopf jeder Mail, wie in der Kopfzeile des Tools. */
export const MAIL_BRAND = { letter: 'A', name: 'Abstimmungstool' }

/**
 * Mail mit Anrede, Text, einem Knopf und Kleingedrucktem - aus den Bausteinen der Suite (renderMail aus suite-kit,
 * dieselbe Vorlage in allen Tools). HTML und Klartext aus demselben Inhalt, alles escapet.
 */
function layout(heading: string, body: string, buttonLabel: string, link: string, footer: string): RenderedMail {
  return renderMail({
    brand: MAIL_BRAND,
    heading,
    blocks: [{ kind: 'p', text: 'Hallo,' }, { kind: 'p', text: body }, { kind: 'button', label: buttonLabel, href: link }],
    footer
  })
}

async function send(toEmail: string, subject: string, { html, text }: RenderedMail): Promise<boolean> {
  if (!isMailConfigured()) return false

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      subject,
      text,
      html,
      envelope: { from: process.env.SMTP_USER, to: toEmail }
    })
    return true
  } catch (error) {
    console.error(`Fehler beim Senden einer Mail an ${toEmail}:`, error)
    return false
  }
}

/** Einladung zu einem neu angelegten Konto - der Link legt das erste Passwort fest. */
export async function sendInviteEmail(toEmail: string, link: string, validDays: number): Promise<boolean> {
  return send(
    toEmail,
    'Einladung zum Abstimmungstool',
    layout(
      'Einladung zum Abstimmungstool',
      `Für dich wurde ein Konto angelegt. Lege jetzt dein Passwort fest - der Link ist ${validDays} Tage gültig und nur einmal nutzbar.`,
      'Passwort festlegen',
      link,
      'Falls du damit nicht gerechnet hast, ignoriere diese Mail einfach.'
    )
  )
}

/** Passwort-Reset auf Wunsch des Kontoinhabers. */
export async function sendPasswordResetEmail(toEmail: string, link: string): Promise<boolean> {
  return send(
    toEmail,
    'Passwort zurücksetzen - Abstimmungstool',
    layout(
      'Passwort zurücksetzen',
      'Für dein Konto wurde ein neues Passwort angefordert. Der Link ist 1 Stunde gültig und nur einmal nutzbar.',
      'Neues Passwort festlegen',
      link,
      'Falls du das nicht warst, ignoriere diese Mail - dein Passwort bleibt unverändert.'
    )
  )
}

/** Persönlicher Stimmlink (Modus LINK) - jede Person bekommt ihren eigenen. */
export async function sendVoterLinkEmail(toEmail: string, pollTitle: string, link: string): Promise<boolean> {
  return send(
    toEmail,
    `Deine Einladung zur Abstimmung: ${pollTitle}`,
    layout(
      pollTitle,
      'Du bist eingeladen, bei dieser Abstimmung mitzumachen. Das ist dein persönlicher Link - bitte gib ihn nicht weiter, er zählt als deine Stimme. Solange die Abstimmung offen ist, kannst du deine Auswahl über denselben Link ändern.',
      'Zur Abstimmung',
      link,
      'Du hast diese Mail bekommen, weil dich jemand zu dieser Abstimmung eingeladen hat.'
    )
  )
}

/** Bestätigungslink für den Modus EMAIL - wer die Adresse bestätigt, kann abstimmen. */
export async function sendVoteConfirmationEmail(toEmail: string, pollTitle: string, link: string, validHours: number): Promise<boolean> {
  return send(
    toEmail,
    `Bitte bestätige deine Adresse: ${pollTitle}`,
    layout(
      pollTitle,
      `Jemand (vermutlich du) möchte mit dieser Adresse bei dieser Abstimmung abstimmen. Bestätige die Adresse mit dem Button - der Link ist ${validHours} Stunden gültig und nur einmal nutzbar.`,
      'Adresse bestätigen',
      link,
      'Falls du das nicht warst, ignoriere diese Mail einfach - ohne Bestätigung passiert nichts.'
    )
  )
}

/** Ergebnis beim Schließen an das besitzende Konto (Poll.notifyOwnerOnClose, siehe app/lib/poll-closed.ts). */
export async function sendPollResultEmail(
  toEmail: string,
  result: { title: string; lines: string[]; summary: string },
  link: string
): Promise<boolean> {
  return send(toEmail, `Abstimmung beendet: ${result.title}`, renderMail({
    brand: MAIL_BRAND,
    heading: `Abstimmung beendet: ${result.title}`,
    blocks: [
      { kind: 'p', text: 'Hallo,' },
      { kind: 'p', text: [{ strong: result.summary }] },
      { kind: 'list', items: result.lines },
      { kind: 'p', text: 'Alle Details und den CSV-Export findest du auf der Verwaltungsseite.' },
      { kind: 'button', label: 'Zur Verwaltungsseite', href: link }
    ],
    footer: 'Du bekommst diese Mail, weil bei dieser Abstimmung „Ergebnis beim Schließen mitteilen“ eingeschaltet ist.'
  }))
}

/** Terminabstimmung: der festgelegte Termin an eine abstimmende Person (app/lib/final-date.ts). */
export async function sendFinalDateEmail(toEmail: string, pollTitle: string, dateLabel: string, pollLink: string, eventUrl: string | null): Promise<boolean> {
  const link = eventUrl ?? pollLink
  return send(
    toEmail,
    `Termin steht fest: ${pollTitle}`,
    layout(
      `Termin steht fest: ${pollTitle}`,
      `Die Terminabstimmung ist entschieden: ${dateLabel}.${eventUrl ? ' Über den Button kannst du direkt zu- oder absagen.' : ''}`,
      eventUrl ? 'Zur Veranstaltung' : 'Zum Ergebnis',
      link,
      'Du bekommst diese Mail, weil du bei der Abstimmung mitgemacht hast.'
    )
  )
}

/** Terminabstimmung: Bitte an die Verwaltung, den Termin zu bestätigen bzw. bei Gleichstand zu entscheiden. */
export async function sendDecisionRequestEmail(toEmail: string, pollTitle: string, summary: string, link: string, tie: boolean): Promise<boolean> {
  const ask = tie ? 'Es gibt einen Gleichstand - bitte entscheide dich für einen der Termine.' : 'Bitte bestätige den Termin.'
  return send(
    toEmail,
    `${tie ? 'Termin entscheiden' : 'Termin bestätigen'}: ${pollTitle}`,
    layout(
      `${tie ? 'Termin entscheiden' : 'Termin bestätigen'}: ${pollTitle}`,
      `Die Terminabstimmung ist beendet. ${summary} ${ask} Erst danach werden die Abstimmenden benachrichtigt und der Termin ggf. an rsvp-app übergeben.`,
      tie ? 'Termin auswählen' : 'Termin bestätigen',
      link,
      'Du bekommst diese Mail, weil dir diese Abstimmung gehört.'
    )
  )
}
