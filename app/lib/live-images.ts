import { prisma } from './prisma'

/**
 * Bilder zu Fragen einer Live-Runde (schema.prisma LiveImage). Der Editor verkleinert und kodiert
 * sie im Browser neu (app/live/questions-editor.tsx) - das entfernt auch EXIF-Daten wie den
 * Aufnahmeort. Hier wird nur noch geprüft, was ankommt: Größe und - am Dateiinhalt, nicht am
 * angegebenen Typ - ob es wirklich ein Rasterbild ist. SVG ist bewusst nicht dabei (kann Skripte enthalten).
 */

export const MAX_IMAGE_BYTES = 1_500_000

const SIGNATURES: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', test: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', test: b => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { type: 'image/gif', test: b => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')) }
]

/** Liest ein hochgeladenes Bild. null = kein Bild, zu groß oder kein erlaubtes Format. */
export async function readImage(value: FormDataEntryValue | null): Promise<{ type: string; data: Uint8Array<ArrayBuffer> } | null> {
  if (!value || typeof value === 'string' || value.size === 0 || value.size > MAX_IMAGE_BYTES) return null
  const data = new Uint8Array(await value.arrayBuffer())
  const head = Buffer.from(data.subarray(0, 16))
  const match = SIGNATURES.find(s => s.test(head))
  return match ? { type: match.type, data } : null
}

/** Bilder einer Runde, die keine Frage mehr benutzt (nach dem Bearbeiten), löschen. */
export async function deleteUnusedImages(sessionId: string): Promise<void> {
  await prisma.liveImage.deleteMany({ where: { sessionId, questions: { none: {} } } })
}
