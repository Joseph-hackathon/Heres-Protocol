import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getAppOrigin } from '@/lib/app-url'
import { getCapsuleSubscription } from '@/lib/subscription-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { capsuleAddress } = body

    if (!capsuleAddress) {
      return NextResponse.json(
        { error: 'Missing capsuleAddress' },
        { status: 400 }
      )
    }

    const sub = await getCapsuleSubscription(capsuleAddress)

    if (!sub || !sub.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No active Stripe customer found for this capsule' },
        { status: 404 }
      )
    }

    const appOrigin = getAppOrigin() || `${req.nextUrl.protocol}//${req.nextUrl.host}`
    const returnUrl = `${appOrigin}/dashboard?capsule=${capsuleAddress}`

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('[create-portal-session] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
