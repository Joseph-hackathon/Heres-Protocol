import Stripe from 'stripe'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'

if (!process.env.STRIPE_SECRET_KEY && typeof window === 'undefined') {
  console.warn('STRIPE_SECRET_KEY is not configured in environment variables. Using placeholder for build compile.')
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16' as any,
  appInfo: {
    name: 'Heres Protocol',
    version: '0.1.0',
  },
})
