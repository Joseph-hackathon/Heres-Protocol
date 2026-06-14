'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Renders the global app chrome (Navbar + Footer) around page content, EXCEPT on
 * the marketing landing route ("/"), which ships its own self-contained chrome
 * (MarketingNav / MarketingFooter) and full-bleed background. nav/footer are
 * passed as slots so this client component never imports the server/client
 * chrome directly.
 */
export function SiteChrome({
  nav,
  footer,
  children,
}: {
  nav: ReactNode
  footer: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const isLanding = pathname === '/'

  if (isLanding) {
    // The landing page provides its own <main>, header and footer.
    return <>{children}</>
  }

  return (
    <>
      {nav}
      <main className="min-h-screen">{children}</main>
      {footer}
    </>
  )
}
