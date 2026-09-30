// app/ui/qr-code.tsx
'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * QR-Code als SVG, im Browser erzeugt - der Inhalt (z.B. ein persönlicher Stimmlink) geht
 * so an keinen weiteren Dienst und landet in keiner URL. Das SVG stammt von der Bibliothek
 * selbst und enthält nur Pfade, daher ist dangerouslySetInnerHTML hier unbedenklich.
 */
export default function QrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let active = true
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then(result => { if (active) setSvg(result) })
      .catch(() => { if (active) setSvg('') })
    return () => { active = false }
  }, [value])

  return (
    <div
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      className="bg-white"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
