/**
 * Email templates for the self-hosted intent-delivery engine.
 *
 * Plain, no-emoji, accessible HTML with a matching text part. User-supplied
 * content (the intent statement) is HTML-escaped before interpolation.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function appUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_APP_URL?.trim()
  return v ? v.replace(/\/+$/, '') : null
}

type RenderedEmail = { subject: string; html: string; text: string }

const WRAP_OPEN =
  '<div style="font-family:ui-sans-serif,system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.6">'
const WRAP_CLOSE = '</div>'

/**
 * Sent to the named recipient once a capsule has fired after the owner exceeded
 * the configured inactivity period. Carries the owner's plaintext intent statement.
 */
export function renderIntentEmail(args: { message: string; capsuleAddress: string }): RenderedEmail {
  const subject = 'A message has been left for you via Heres Protocol'
  const safeMessage = escapeHtml(args.message)
  const safeCapsule = escapeHtml(args.capsuleAddress)
  const link = appUrl()

  const html =
    WRAP_OPEN +
    '<h2 style="font-weight:600;margin:0 0 12px">A message has been left for you</h2>' +
    '<p>Someone set up an inheritance capsule on Heres Protocol and named you as the person to receive the following statement. ' +
    'It is being delivered now because their on-chain activity stopped for longer than the period they configured.</p>' +
    '<blockquote style="margin:20px 0;padding:16px 20px;border-left:3px solid #2DD4E8;background:#f6fbfc;white-space:pre-wrap">' +
    safeMessage +
    '</blockquote>' +
    `<p style="color:#666;font-size:13px">Capsule reference: <code>${safeCapsule}</code></p>` +
    (link ? `<p style="font-size:13px"><a href="${link}/capsules/${safeCapsule}">View capsule details</a></p>` : '') +
    '<p style="color:#999;font-size:12px;margin-top:24px">This is an automated, one-time delivery from Heres Protocol. ' +
    'You are receiving it because your email was registered as the recipient for this capsule.</p>' +
    WRAP_CLOSE

  const text =
    'A message has been left for you\n\n' +
    'Someone set up an inheritance capsule on Heres Protocol and named you as the person to receive the following statement. ' +
    'It is being delivered now because their on-chain activity stopped for longer than the period they configured.\n\n' +
    '--------------------\n' +
    args.message +
    '\n--------------------\n\n' +
    `Capsule reference: ${args.capsuleAddress}\n` +
    (link ? `View capsule: ${link}/capsules/${args.capsuleAddress}\n` : '') +
    '\nThis is an automated, one-time delivery from Heres Protocol.'

  return { subject, html, text }
}

/**
 * Sent to a still-living owner's named contact as a periodic heads-up that an
 * active capsule exists and will fire if the owner goes silent. Carries no
 * private statement - only the configured metadata.
 */
export function renderReminderEmail(args: {
  assetLabel: string
  totalAmount?: string
  beneficiaryCount: number
  inactivityLabel: string
  capsuleAddress: string
}): RenderedEmail {
  const subject = 'Reminder: an active Heres Protocol capsule names you'
  const safeCapsule = escapeHtml(args.capsuleAddress)
  const amount = args.totalAmount ? `${escapeHtml(args.totalAmount)} ` : ''
  const link = appUrl()

  const html =
    WRAP_OPEN +
    '<h2 style="font-weight:600;margin:0 0 12px">An active capsule names you</h2>' +
    '<p>This is a periodic reminder that an inheritance capsule on Heres Protocol is configured to deliver to you ' +
    'if its owner stops being active on-chain.</p>' +
    '<ul style="padding-left:18px">' +
    `<li>Asset: ${amount}${escapeHtml(args.assetLabel)}</li>` +
    `<li>Beneficiaries: ${args.beneficiaryCount}</li>` +
    `<li>Triggers after: ${escapeHtml(args.inactivityLabel)} of inactivity</li>` +
    '</ul>' +
    `<p style="color:#666;font-size:13px">Capsule reference: <code>${safeCapsule}</code></p>` +
    (link ? `<p style="font-size:13px"><a href="${link}/capsules/${safeCapsule}">View capsule details</a></p>` : '') +
    '<p style="color:#999;font-size:12px;margin-top:24px">No action is required. You will be contacted again only if the capsule fires.</p>' +
    WRAP_CLOSE

  const text =
    'An active capsule names you\n\n' +
    'This is a periodic reminder that an inheritance capsule on Heres Protocol is configured to deliver to you ' +
    'if its owner stops being active on-chain.\n\n' +
    `Asset: ${amount}${args.assetLabel}\n` +
    `Beneficiaries: ${args.beneficiaryCount}\n` +
    `Triggers after: ${args.inactivityLabel} of inactivity\n\n` +
    `Capsule reference: ${args.capsuleAddress}\n` +
    (link ? `View capsule: ${link}/capsules/${args.capsuleAddress}\n` : '') +
    '\nNo action is required. You will be contacted again only if the capsule fires.'

  return { subject, html, text }
}
