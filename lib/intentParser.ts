export function parseIntentData(intentData: Uint8Array): {
  totalAmount: string
  assetSymbol?: string
  beneficiaries: Array<{ address: string; amount: string; amountType?: string; chain?: string }>
  distributionMode?: 'public' | 'private'
} | null {
  try {
    const jsonStr = new TextDecoder().decode(intentData)
    const data = JSON.parse(jsonStr) as any
    if (!data) return null

    const beneficiaries = (data.beneficiaries || []).map((b: any) => ({
      address: b.address || '',
      amount: String(b.amount || '0'),
      amountType: b.amountType || 'fixed',
      chain: b.chain || 'solana',
    }))

    return {
      totalAmount: data.totalAmount || '0',
      assetSymbol: data.assetSymbol,
      beneficiaries,
      distributionMode: data.distributionMode || 'public',
    }
  } catch {
    return null
  }
}
