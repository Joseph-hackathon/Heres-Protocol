import 'server-only'

/**
 * Transactional email transport via Resend's HTTP API.
 *
 * No SDK dependency - a plain fetch keeps the bundle lean and avoids another
 * supply-chain surface. This is our own delivery leg: it replaces the Chainlink
 * CRE webhook (early-access, gated on their permissions) with a provider we
 * control directly. Throws on any non-2xx so the caller's retry/backoff engages.
 */

type SendEmailArgs = {
  to: string
  subject: string
  html: string
  text: string
}

function env(name: string): string | null {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : null
}

/** True when Resend credentials + a verified sender are configured. */
export function isEmailConfigured(): boolean {
  return Boolean(env('RESEND_API_KEY') && env('RESEND_FROM'))
}

export async function sendEmail(args: SendEmailArgs): Promise<{ providerMessageId: string }> {
  const apiKey = env('RESEND_API_KEY')
  const from = env('RESEND_FROM')
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY and RESEND_FROM must be configured to send email')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend error ${response.status}: ${body.slice(0, 500)}`)
  }

  const json = (await response.json().catch(() => ({}))) as { id?: string }
  return { providerMessageId: json.id ?? '' }
}
