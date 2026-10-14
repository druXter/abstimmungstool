'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HEIGHT_MESSAGE } from '../../lib/survey-embed'

/**
 * Inhalt der eingebetteten Seite: meldet seine Höhe bei jeder Änderung per postMessage an die
 * einbettende Seite, damit sie das iFrame ohne eigene Bildlaufleiste passend groß machen kann. Nur
 * die Höhe und die ID geht hinaus - nichts, was eine fremde Seite nicht ohnehin sähe.
 */
export function EmbedRoot({ surveyId, children }: { surveyId: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = root.current
    if (!element || window.parent === window) return
    const report = () => window.parent.postMessage({ type: HEIGHT_MESSAGE, id: surveyId, height: Math.ceil(element.getBoundingClientRect().height) }, '*')
    const observer = new ResizeObserver(report)
    observer.observe(element)
    report()
    return () => observer.disconnect()
  }, [surveyId])

  return <div ref={root} data-embed className="p-2 sm:p-3">{children}</div>
}

/**
 * Nur im Modus COOKIE und eingebettet: Kann diese Seite hier kein Cookie setzen (iFrame in einer
 * anderen Website, Browser blockiert Drittanbieter-Cookies), gäbe jede Abgabe eine neue Antwort und
 * Ändern ginge nicht. Dann statt des Formulars ein Link, der den Fragebogen in einem neuen Tab öffnet.
 */
export function CookieGate({ href, children }: { href: string; children: ReactNode }) {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (window.parent === window) return
    const probe = `cookie_probe=${Math.random().toString(36).slice(2)}`
    try {
      document.cookie = `${probe}; path=/; max-age=60; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
      const ok = document.cookie.includes(probe)
      document.cookie = `${probe.split('=')[0]}=; path=/; max-age=0`
      // Erst nach dem Rendern feststellbar (document.cookie gibt es auf dem Server nicht).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!ok) setBlocked(true)
    } catch {
      setBlocked(true)
    }
  }, [])

  if (!blocked) return <>{children}</>
  return (
    <div className="space-y-3 text-sm" data-testid="cookie-blocked">
      <p className="text-gray-600 dark:text-gray-400">
        Hier kann jede Person nur einmal antworten. Dafür muss sich dein Browser das merken - in dieser App lässt er das nicht zu.
      </p>
      <a href={href} target="_blank" rel="noopener" className="inline-flex rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
        Fragebogen in neuem Tab öffnen ↗
      </a>
    </div>
  )
}
