import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { getAppOrigin } from '@/lib/app-url'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { capsuleAddress, ownerAddress } = body

    if (!capsuleAddress || !ownerAddress) {
      return NextResponse.json(
        { error: 'Missing capsuleAddress or ownerAddress' },
        { status: 400 }
      )
    }

    const appOrigin = getAppOrigin() || `${req.nextUrl.protocol}//${req.nextUrl.host}`
    const successUrl = `${appOrigin}/dashboard?session_id={CHECKOUT_SESSION_ID}&capsule=${capsuleAddress}&payment=stripe_success`
    const cancelUrl = `${appOrigin}/dashboard?capsule=${capsuleAddress}&payment=stripe_cancel`

    const priceId = process.env.STRIPE_PRICE_ID

    const sessionParams: any = {
      mode: 'subscription',
      payment_method_types: ['card'],
      client_reference_id: capsuleAddress,
      metadata: {
        capsuleAddress,
        ownerAddress,
      },
      subscription_data: {
        metadata: {
          capsuleAddress,
          ownerAddress,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    }

    if (priceId) {
      sessionParams.line_items = [{ price: priceId, quantity: 1 }]
    } else {
      // Inline price creation for easy development/fallback
      sessionParams.line_items = [
        {
          price_data: {
            currency: 'usd',
            recurring: { interval: 'month' },
            unit_amount: 200, // $2.00
            product_data: {
              name: 'Heres Capsule Automated Monitoring',
              description: 'Provides automated off-chain crank and Chainlink CRE monitoring.',
            },
          },
          quantity: 1,
        },
      ]
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('[create-checkout-session] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
