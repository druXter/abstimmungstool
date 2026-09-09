// app/ui/copyable-field.tsx
'use client'

/**
 * Read-only Eingabefeld, das seinen Inhalt beim Anklicken markiert (zum einfachen
 * Kopieren). Muss eine Client-Komponente sein - Next.js 16 lässt keine
 * Event-Handler mehr an Elemente in Server Components (siehe AGENTS.md).
 */
export default function CopyableField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type="text"
        readOnly
        value={value}
        className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-sm text-gray-700 cursor-pointer"
        onClick={(e) => e.currentTarget.select()}
      />
    </div>
  )
}
