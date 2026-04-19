'use client'
import { useState } from 'react'

export default function MagicRequestClient() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    try {
      await fetch('/api/auth/magic/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // Swallow — we always show the success state to avoid disclosing
      // whether the email is enrolled.
    }
    setStatus('sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm p-8">
        {status === 'sent' ? (
          <>
            <h1 className="text-xl font-semibold text-gray-900">Check your inbox</h1>
            <p className="mt-2 text-sm text-gray-600">
              If this email is linked to a course you purchased, a new sign-in link
              is on its way. Links expire after 7 days.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-gray-900">Request a new link</h1>
            <p className="mt-2 text-sm text-gray-600">
              Enter the email address you used at checkout. If you have a current
              enrollment, we&apos;ll send you a fresh sign-in link.
            </p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <button
                type="submit"
                disabled={status === 'sending' || !email}
                className="w-full bg-black text-white font-semibold py-2.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {status === 'sending' ? 'Sending…' : 'Send link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
