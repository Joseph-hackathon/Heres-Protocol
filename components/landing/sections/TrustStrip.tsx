import Image from 'next/image'

export function TrustStrip() {
  return (
    <section className="trust wrap" aria-label="Trusted infrastructure">
      <p className="trust__label reveal">Built on the infrastructure you already trust</p>
      <div className="trust__logos reveal">
        <span className="logo" title="MagicBlock">
          <Image src="/logos/magicblock.svg" alt="MagicBlock" width={120} height={24} style={{ height: '24px', width: 'auto' }} unoptimized />
        </span>
        <span className="logo" title="Solana">
          <Image src="/logos/solana.svg" alt="Solana" width={120} height={24} style={{ height: '24px', width: 'auto' }} unoptimized />
        </span>
        <span className="logo" title="Helius">
          <Image src="/logos/helius.svg" alt="Helius" width={120} height={24} style={{ height: '24px', width: 'auto' }} unoptimized />
        </span>
        <span className="logo" title="Alchemy">
          <Image src="/logos/alchemy-logo.svg" alt="Alchemy" width={120} height={24} style={{ height: '24px', width: 'auto' }} unoptimized />
        </span>
      </div>
      <p className="trust__sub reveal">Running on Solana, secured by MagicBlock&apos;s Trusted Execution Environment.</p>
    </section>
  )
}
