/**
 * Live Resend send-test for the self-hosted intent-delivery engine.
 *
 * Exercises the REAL pieces: at-rest encrypt -> decrypt (lib/intent-delivery/at-rest)
 * and the REAL email template (lib/intent-delivery/email-templates), then POSTs to
 * the Resend API exactly like lib/intent-delivery/email.ts does. It does not touch
 * Redis or the chain - it isolates the delivery leg.
 *
 * Run (loads .env for RESEND_API_KEY / INTENT_AT_REST_KEY):
 *   node --env-file=.env --experimental-strip-types \
 *     scripts/intent-delivery/resend-send-test.mts <recipient-email>
 *
 * FROM defaults to Resend's onboarding sender (works without a verified domain,
 * but only delivers to the email your Resend account is registered under).
 */
import { renderIntentEmail } from '../../lib/intent-delivery/email-templates.ts'
import { encryptAtRest, decryptAtRest } from '../../lib/intent-delivery/at-rest.ts'

const apiKey = process.env.RESEND_API_KEY?.trim()
const from = process.env.TEST_FROM?.trim() || process.env.RESEND_FROM?.trim() || 'onboarding@resend.dev'
const to = process.argv[2]?.trim() || process.env.TEST_RECIPIENT?.trim()

if (!apiKey) {
  console.error('RESEND_API_KEY is not set (run with --env-file=.env)')
  process.exit(1)
}
if (!to) {
  console.error('Recipient required: pass as argv[2] or set TEST_RECIPIENT')
  process.exit(1)
}

// Prove the at-rest path the dispatcher relies on.
const sample =
  'This is a TEST intent statement from Heres Protocol.\n\nIf you are reading this, the self-hosted intent-delivery engine works end to end: encrypt at rest, decrypt at dispatch, and deliver by email.'
const cipher = encryptAtRest(sample)
const message = decryptAtRest(cipher)
console.log('at-rest round-trip:', message === sample ? 'OK' : 'FAILED')
if (message !== sample) process.exit(1)

const { subject, html, text } = renderIntentEmail({
  message,
  capsuleAddress: 'TEST1111111111111111111111111111111111111111',
})

console.log(`sending: from="${from}" to="${to}"`)
const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from, to: [to], subject: `[TEST] ${subject}`, html, text }),
})

const body = await res.text()
console.log('resend status:', res.status)
console.log('resend response:', body)
process.exit(res.ok ? 0 : 1)
