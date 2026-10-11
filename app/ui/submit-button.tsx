// app/ui/submit-button.tsx

/**
 * Einheitlicher primärer Speichern-/Absenden-Button, wie in rsvp-app. Standard: volle Breite (Formulare wie
 * Anmelden); `inline` für Knöpfe neben anderen Aktionen, etwa in der Speichern-Leiste der Einstellungen.
 */
export default function SubmitButton({
  children,
  disabled = false,
  inline = false,
  className = ''
}: {
  children: React.ReactNode
  disabled?: boolean
  inline?: boolean
  className?: string
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`${inline ? '' : 'w-full'} rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}
