// app/lib/mail.ts
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

/** Maskiert Text für die Verwendung in HTML (Mail-Inhalte enthalten u.a. frei wählbare Namen/Titel). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function layout(heading: string, body: string, buttonLabel: string, link: string, footer: string): string {
  return `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>${esc(heading)}</h2>
        <p>${esc(body)}</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${esc(link)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">${esc(buttonLabel)}</a>
        </p>
        <p style="font-size: 12px; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${esc(link)}</p>
        <p style="font-size: 12px; color: #666;">${esc(footer)}</p>
      </div>
    `
}

async function send(toEmail: string, subject: string, text: string, html: string): Promise<boolean> {
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
    `Hallo,

für dich wurde ein Konto im Abstimmungstool angelegt. Lege mit diesem Link dein Passwort fest (${validDays} Tage gültig, nur einmal nutzbar):
${link}

Falls du damit nicht gerechnet hast, ignoriere diese Mail einfach.`,
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
    `Hallo,

für dein Konto im Abstimmungstool wurde ein neues Passwort angefordert. Mit diesem Link kannst du es festlegen (1 Stunde gültig, nur einmal nutzbar):
${link}

Falls du das nicht warst, ignoriere diese Mail - dein Passwort bleibt unverändert.`,
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
    `Hallo,

du bist eingeladen, bei der Abstimmung "${pollTitle}" mitzumachen. Das ist dein persönlicher Link - bitte gib ihn nicht weiter, er zählt als deine Stimme:
${link}

Solange die Abstimmung offen ist, kannst du deine Auswahl über denselben Link ändern.`,
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
    `Hallo,

jemand (vermutlich du) möchte mit dieser Adresse bei der Abstimmung "${pollTitle}" abstimmen. Mit diesem Link bestätigst du die Adresse (${validHours} Stunden gültig, nur einmal nutzbar):
${link}

Falls du das nicht warst, ignoriere diese Mail einfach - ohne Bestätigung passiert nichts.`,
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
  const listHtml = result.lines.map(line => `<li>${esc(line)}</li>`).join('')
  return send(
    toEmail,
    `Abstimmung beendet: ${result.title}`,
    `Hallo,

die Abstimmung "${result.title}" ist beendet.

${result.summary}

${result.lines.map(line => `- ${line}`).join('\n')}

Alle Details und den CSV-Export findest du auf der Verwaltungsseite:
${link}`,
    `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>Abstimmung beendet: ${esc(result.title)}</h2>
        <p><strong>${esc(result.summary)}</strong></p>
        <ul>${listHtml}</ul>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${esc(link)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">Zur Verwaltungsseite</a>
        </p>
        <p style="font-size: 12px; color: #666;">Du bekommst diese Mail, weil bei dieser Abstimmung "Ergebnis beim Schließen mitteilen" eingeschaltet ist.</p>
      </div>
    `
  )
}

/** Terminabstimmung: der festgelegte Termin an eine abstimmende Person (app/lib/final-date.ts). */
export async function sendFinalDateEmail(toEmail: string, pollTitle: string, dateLabel: string, pollLink: string, eventUrl: string | null): Promise<boolean> {
  const link = eventUrl ?? pollLink
  return send(
    toEmail,
    `Termin steht fest: ${pollTitle}`,
    `Hallo,

die Terminabstimmung "${pollTitle}" ist entschieden: ${dateLabel}.
${eventUrl ? `\nZur Veranstaltung (Zu-/Absage): ${eventUrl}\n` : ''}
Ergebnis der Abstimmung: ${pollLink}

Du bekommst diese Mail, weil du bei der Abstimmung mitgemacht hast.`,
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
    `Hallo,

die Terminabstimmung "${pollTitle}" ist beendet. ${summary}

${ask} Erst danach werden die Abstimmenden benachrichtigt und der Termin ggf. an rsvp-app übergeben:
${link}`,
    layout(
      `${tie ? 'Termin entscheiden' : 'Termin bestätigen'}: ${pollTitle}`,
      `Die Terminabstimmung ist beendet. ${summary} ${ask} Erst danach werden die Abstimmenden benachrichtigt und der Termin ggf. an rsvp-app übergeben.`,
      tie ? 'Termin auswählen' : 'Termin bestätigen',
      link,
      'Du bekommst diese Mail, weil dir diese Abstimmung gehört.'
    )
  )
}
