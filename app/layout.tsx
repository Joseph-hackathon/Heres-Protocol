import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, Oswald } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister'

const notoSansKR = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-sans',
  display: 'swap',
})

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-display',
  display: 'swap',
})

export const viewport: Viewport = {
  themeColor: '#1E90FF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Heres - Privacy-Preserving Capsule Protocol on Solana',
  description:
    'A privacy-preserving capsule protocol on Solana. Assets stay delegated, conditions stay private inside Magicblock ER, execution happens automatically when silence becomes truth. Powered by Helius & Phantom.',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/logo-white.png', type: 'image/png' }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${notoSansKR.variable} ${oswald.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <ServiceWorkerRegister />
          <Navbar />
          <main className="min-h-screen">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
