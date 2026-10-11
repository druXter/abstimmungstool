// app/ui/nav-link.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Link der Navigation, hervorgehoben, wenn die aktuelle Seite dazugehört (wie in rsvp-app). `match`: Pfade (genau
 * oder als Präfix mit "/"), `exact`: nur genau der Pfad von `href` (für Reiter wie "Übersicht"). Eine Query am
 * `href` (z.B. der Verwaltungs-Token von Alt-Abstimmungen) zählt beim Vergleich nicht.
 */
export default function NavLink({ href, match, exact = false, children, variant = 'top' }: { href: string; match?: string[]; exact?: boolean; children: ReactNode; variant?: 'top' | 'tab' }) {
  const pathname = usePathname()
  const path = href.split('?')[0]
  const paths = match ?? [path]
  const active = exact ? pathname === path : paths.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (variant === 'tab') {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${active ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        {children}
      </Link>
    )
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'}`}>
      {children}
    </Link>
  )
}
