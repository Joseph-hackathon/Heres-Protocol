import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, Oswald, Newsreader, Hanken_Grotesk } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/Navbar'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteChrome } from '@/components/SiteChrome'
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

// Marketing landing typefaces (Design 04 "Elevated"): editorial serif + grotesk.
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['300', '400', '500'],
  variable: '--font-serif',
  display: 'swap',
})

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
})

export const viewport: Viewport = {
  themeColor: '#2DD4E8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Heresprotocol - Privacy-Preserving Death Insurance Protocol on Solana',
  description:
    'A privacy-preserving capsule protocol on Solana. Assets stay delegated, conditions stay private inside Magicblock ER, execution happens automatically when silence becomes truth. Powered by Helius & Phantom.',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/logo-white-icon.png', type: 'image/png' }],
  },
  openGraph: {
    title: 'Heresprotocol - Privacy-Preserving Death Insurance Protocol on Solana',
    description:
      'A privacy-preserving capsule protocol on Solana. Assets stay delegated, conditions stay private inside Magicblock ER, execution happens automatically when silence becomes truth. Powered by Helius & Phantom.',
    siteName: 'Heresprotocol',
    url: 'https://heresprotocol.com',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${notoSansKR.variable} ${oswald.variable} ${newsreader.variable} ${hankenGrotesk.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                name: 'Heresprotocol',
                url: 'https://heresprotocol.com',
              },
              {
                '@context': 'https://schema.org',
                '@type': 'Organization',
                name: 'Heresprotocol',
                url: 'https://heresprotocol.com',
                logo: 'https://heresprotocol.com/logo-white-icon.png',
              },
            ]),
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <ServiceWorkerRegister />
          <SiteChrome nav={<Navbar />} footer={<SiteFooter />}>
            {children}
          </SiteChrome>
        </Providers>
      </body>
    </html>
  )
}