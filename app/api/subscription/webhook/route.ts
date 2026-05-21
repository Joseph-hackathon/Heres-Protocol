import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { upsertStripeSubscription, updateStripeSubscriptionStatus } from '@/lib/subscription-store'

export async function POST(req: NextRequest) {
  let event: any
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') || ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } else {
      // Dev mode fallback when webhook secret is not configured
      console.warn('STRIPE_WEBHOOK_SECRET is empty. Skipping Stripe webhook signature verification.')
      event = JSON.parse(rawBody)
    }
  } catch (err: any) {
    console.error(`Webhook signature verification failed:`, err.message)
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  const eventType = event.type || event.kind

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const capsuleAddress = session.client_reference_id || session.metadata?.capsuleAddress
        const ownerAddress = session.metadata?.ownerAddress
        const stripeSubscriptionId = session.subscription as string
        const stripeCustomerId = session.customer as string

        if (!capsuleAddress || !ownerAddress) {
          console.warn('[Stripe Webhook] Missing capsuleAddress or ownerAddress in checkout metadata')
          break
        }

        // Fetch subscription to get current period end
        const subscription: any = await stripe.subscriptions.retrieve(stripeSubscriptionId)
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000)
        const status = subscription.status

        await upsertStripeSubscription(
          capsuleAddress,
          ownerAddress,
          stripeCustomerId,
          stripeSubscriptionId,
          status,
          currentPeriodEnd
        )
        console.log(`[Stripe Webhook] Subscription successfully created for capsule ${capsuleAddress}`)
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const stripeSubscriptionId = subscription.id
        const status = subscription.status
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000)

        await updateStripeSubscriptionStatus(stripeSubscriptionId, status, currentPeriodEnd)
        console.log(`[Stripe Webhook] Subscription ${stripeSubscriptionId} status updated to ${status}`)
        break
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${eventType}`)
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('[Stripe Webhook] Error processing event:', error)
    return NextResponse.json({ error: 'Webhook Handler Failed' }, { status: 500 })
  }
}
