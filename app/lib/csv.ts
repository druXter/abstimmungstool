/**
 * Ein CSV-Feld: in Anführungszeichen, innere verdoppelt. Werte, die mit = + - @ (oder Tab/CR)
 * beginnen, bekommen ein Apostroph vorangestellt - Namen und Optionen sind frei eingegeben,
 * und Tabellenprogramme würden sie sonst als Formel ausführen (CSV-Injection).
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** Semikolon und UTF-8 mit BOM, damit ein deutsches Excel die Datei ohne Import-Assistenten richtig öffnet. */
export function csvResponse(rows: string[][], filename: string): Response {
  const csv = '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  })
}
