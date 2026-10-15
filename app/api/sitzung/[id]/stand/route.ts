// app/api/sitzung/[id]/stand/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'

/** Stand einer Sitzung für die Ansichten (app/sitzung/live-refresh.tsx): nur die Versionsnummer, ohne Inhalt. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const assembly = await prisma.assembly.findUnique({ where: { id }, select: { version: true } })
  if (!assembly) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ version: assembly.version }, { headers: { 'Cache-Control': 'no-store' } })
}
