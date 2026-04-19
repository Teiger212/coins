import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Forwards a magic-link reissue request from the LH learner page to the
 * bridge service (which owns the Resend credentials + enrollment store).
 *
 * Always 200 — the bridge already returns an opaque OK; we preserve that so
 * this route never leaks whether an email is enrolled.
 */
export async function POST(req: NextRequest) {
  const bridgeUrl = process.env.BRIDGE_INTERNAL_URL
  if (!bridgeUrl) {
    return NextResponse.json({ ok: false, error: 'bridge not configured' }, { status: 503 })
  }

  let body: { email?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: true })
  }

  try {
    const r = await fetch(`${bridgeUrl.replace(/\/$/, '')}/public/magic-link/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await r.json().catch(() => ({ ok: true }))
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    console.error('[magic-reissue] bridge call failed', err)
    return NextResponse.json({ ok: true })
  }
}
