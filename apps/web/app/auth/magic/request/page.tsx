import { Metadata } from 'next'
import MagicRequestClient from './magic-request-client'

export const metadata: Metadata = {
  title: 'Request a new link',
  robots: { index: false, follow: false },
}

export default function MagicRequestPage() {
  return <MagicRequestClient />
}
