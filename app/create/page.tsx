'use client'

import { Shield, Eye, Plus, X, CheckCircle, ChevronDown, ChevronUp, Coins, ImageIcon } from 'lucide-react'
import { Button, Field, Input, Textarea, Select, Stepper } from '@/components/ui'
import { PrivyLoginButton } from '@/components/PrivyLoginButton'
import {
  SOLANA_CONFIG,
  PLATFORM_FEE,
  MAX_CAPSULE_MODIFICATIONS,
} from '@/constants'
import { isValidBeneficiaryAddress, isValidEmail } from '@/utils/validation'
import { TOKEN_2022_PROGRAM_ID } from '@/lib/spl'
import { SectionEyebrow, ServiceAccordionSection, ServiceMetaCard, ServicePageHeader } from '@/components/ui/service-page'
import { useCreateCapsuleForm, CREATE_STEPS, CREATE_FAQS } from '@/hooks/useCreateCapsuleForm'

export default function CreatePage() {
  const {
    connected,
    intent,
    setIntent,
    capsuleType,
    setCapsuleType,
    selectedAssetMint,
    setSelectedAssetMint,
    beneficiaries,
    totalAmount,
    setTotalAmount,
    inactivityDays,
    setInactivityDays,
    inactivityUnit,
    setInactivityUnit,
    targetDate,
    setTargetDate,
    showSimulation,
    setShowSimulation,
    isPending,
    currentStep,
    txHash,
    error,
    existingCapsule,
    modifyCount,
    openSection,
    setOpenSection,
    setOpenFaq,
    isFaqOpen,
    nftList,
    nftListLoading,
    selectedNftMints,
    nftRecipients,
    nftAssignments,
    intentEmail,
    setIntentEmail,
    intentReminderEnabled,
    setIntentReminderEnabled,
    walletTokens,
    tokensLoading,
    supportsMinuteMode,
    selectedToken,
    assetUnit,
    approxFireDate,
    minTargetDate,
    addBeneficiary,
    splitEvenly,
    removeBeneficiary,
    updateBeneficiary,
    toggleNftSelection,
    addNftRecipient,
    removeNftRecipient,
    setNftRecipientAddress,
    setNftAssignment,
    formatInactivityLabel,
    handleCreate,
    simulateExecution,
    hasAssetSelection,
    hasBeneficiaryDetails,
    hasIntentDetails,
    canCompleteAsset,
    canCompleteBeneficiaries,
    canCompleteIntent,
    isCreateReady,
    currentStepIndex,
    currentStepMeta,
  } = useCreateCapsuleForm()

  return (
    <div className="min-h-screen bg-hero pt-24 pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="mb-6">
          <ServicePageHeader
            eyebrow={<SectionEyebrow>Capsule Builder</SectionEyebrow>}
            title={<span className="font-serif"><em className="italic">Create</em> Capsule</span>}
            description="Build the asset payload, define beneficiaries, set trigger conditions, then encrypt the human instruction that accompanies the capsule."
            statusLine={currentStepMeta}
            badges={
              <>
                <span className="create-status-chip">
                  <span className="create-status-chip__dot" />
                  {SOLANA_CONFIG.NETWORK}
                </span>
                <span className="create-status-chip">
                  <span className="create-status-chip__dot" />
                  {capsuleType === 'token' ? `Asset: ${assetUnit}` : capsuleType === 'nft' ? `NFTs: ${selectedNftMints.length}` : 'Asset pending'}
                </span>
                <span className="create-status-chip">
                  <span className="create-status-chip__dot" />
                  PER (TEE) secured
                </span>
              </>
            }
            aside={
              <div className="service-meta-card service-meta-card--accent p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-Heres-muted">Current Snapshot</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <ServiceMetaCard label="Asset" className="bg-Heres-surface/20 shadow-none">
                    <p className="text-[15px] font-semibold text-Heres-white">
                      {capsuleType === 'token' ? `${assetUnit} capsule` : capsuleType === 'nft' ? 'NFT capsule' : 'Not selected'}
                    </p>
                  </ServiceMetaCard>
                  <ServiceMetaCard label="Recipients" className="bg-Heres-surface/20 shadow-none">
                    <p className="text-[15px] font-semibold text-Heres-white">
                      {capsuleType === 'token'
                        ? beneficiaries.filter((b) => b.address.trim()).length
                        : nftRecipients.filter((r) => r.address.trim()).length}
                    </p>
                  </ServiceMetaCard>
                  <ServiceMetaCard label="Readiness" className="bg-Heres-surface/20 shadow-none">
                    <p className={`text-[15px] font-semibold ${isCreateReady ? 'text-emerald-400' : 'text-Heres-accent'}`}>
                      {isCreateReady ? 'Ready to create' : `Step ${currentStepIndex} of ${CREATE_STEPS.length}`}
                    </p>
                  </ServiceMetaCard>
                </div>
              </div>
            }
          />
          <Stepper
            steps={CREATE_STEPS.map((s) => s.label)}
            current={currentStepIndex - 1}
            className="mt-4"
          />
        </header>

        <div className="space-y-5">
          {!connected && (
            <div className="card-Heres p-8 text-center">
              <Shield className="mx-auto mb-5 h-14 w-14 text-Heres-accent" />
              <h2 className="text-2xl font-bold text-Heres-white">Sign In to Continue</h2>
              <p className="mx-auto mt-3 max-w-2xl text-Heres-muted">
                Sign in with your email to unlock capsule creation and NFT/token selection. A secure Solana wallet is created for you automatically.
              </p>
              <div className="mt-6 flex justify-center">
                <PrivyLoginButton className="!h-11 !rounded-xl !bg-Heres-surface !px-5 !py-0 !text-sm !font-medium !text-Heres-white transition-opacity hover:!bg-Heres-card active:scale-95" />
              </div>
            </div>
          )}

          {connected && modifyCount >= MAX_CAPSULE_MODIFICATIONS && (
            <div className="card-Heres border-red-500/40 bg-red-500/5 p-6">
              <div className="flex items-start gap-4">
                <Shield className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-400" />
                <div className="flex-1">
                  <h3 className="mb-2 text-lg font-semibold text-red-400">Modification Limit Reached</h3>
                  <p className="text-Heres-muted">
                    You have used all {MAX_CAPSULE_MODIFICATIONS} capsule modifications for this wallet. No further changes are allowed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {connected && modifyCount > 0 && modifyCount < MAX_CAPSULE_MODIFICATIONS && (
            <div className="rounded-lg border border-Heres-border bg-Heres-surface/50 px-4 py-3 text-sm text-Heres-muted">
              Capsule modifications used: <span className="font-medium text-Heres-white">{modifyCount}</span> / {MAX_CAPSULE_MODIFICATIONS}
            </div>
          )}

          <ServiceAccordionSection
            step="Step 1"
            title="Select Asset Type"
            description="Select your preferred asset type."
            open={openSection === 'asset'}
            onToggle={() => setOpenSection((prev) => (prev === 'asset' ? 'beneficiaries' : 'asset'))}
          >
              <div>
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => setCapsuleType('token')}
                    className={`inline-flex items-center gap-3 rounded-xl border px-5 py-3 text-sm font-medium transition-colors ${capsuleType === 'token'
                      ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                      : 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40 hover:bg-Heres-surface/80'}`}
                  >
                    <Coins className="h-5 w-5 shrink-0" />
                    Token
                  </button>
                  <button
                    type="button"
                    disabled
                    title="NFT capsules return in a later release (the lean program distributes fungible assets by proportional share)."
                    className="inline-flex cursor-not-allowed items-center gap-3 rounded-xl border border-Heres-border bg-Heres-card/40 px-5 py-3 text-sm font-medium text-Heres-muted opacity-50"
                  >
                    <ImageIcon className="h-5 w-5 shrink-0" />
                    NFT
                    <span className="rounded bg-Heres-surface/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                  </button>
                </div>

                {capsuleType === 'token' && (
                  <div className="mt-5 space-y-4 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <div>
                      <label className="mb-2 block text-sm text-Heres-muted">Asset to lock</label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {/* Native SOL is always available. */}
                        <button
                          type="button"
                          onClick={() => setSelectedAssetMint(null)}
                          className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                            selectedAssetMint === null
                              ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                              : 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40'
                          }`}
                        >
                          <p className="text-sm font-semibold">SOL</p>
                          <p className="text-xs text-Heres-muted">Native Solana</p>
                        </button>
                        {/* Any SPL / Token-2022 the connected wallet holds. */}
                        {walletTokens.map((t) => (
                          <button
                            key={t.mint}
                            type="button"
                            onClick={() => setSelectedAssetMint(t.mint)}
                            title={t.mint}
                            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                              selectedAssetMint === t.mint
                                ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                                : 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40'
                            }`}
                          >
                            <p className="text-sm font-semibold">
                              {t.symbol}
                              {t.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() && (
                                <span className="ml-1.5 rounded bg-Heres-surface/80 px-1 py-0.5 text-[9px] uppercase tracking-wide text-Heres-muted">T-2022</span>
                              )}
                            </p>
                            <p className="text-xs text-Heres-muted">Balance: {t.balanceUi}</p>
                          </button>
                        ))}
                      </div>
                      {tokensLoading && <p className="mt-2 text-xs text-Heres-muted">Scanning your wallet for tokens...</p>}
                      {!tokensLoading && connected && walletTokens.length === 0 && (
                        <p className="mt-2 text-xs text-Heres-muted">No SPL tokens found in your wallet - you can still lock SOL.</p>
                      )}
                      {!connected && (
                        <p className="mt-2 text-xs text-Heres-muted">Connect your wallet to see the tokens you can lock.</p>
                      )}
                    </div>
                    <Field
                      label={`Total Amount (${assetUnit})`}
                      hint={`How much ${assetUnit} to lock in the capsule. Each beneficiary receives their share of this.${selectedToken ? ` Available: ${selectedToken.balanceUi} ${assetUnit}.` : ''}`}
                    >
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={totalAmount}
                        onChange={(e) => setTotalAmount(e.target.value)}
                        placeholder="0.0"
                      />
                    </Field>
                  </div>
                )}

                {capsuleType === 'nft' && (
                  <div className="mt-5 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="mb-4 text-sm text-Heres-muted">
                      Choose which NFTs from your wallet to include in this capsule. When conditions are met, they will be transferred to the recipients you set below.
                    </p>
                    {nftListLoading ? (
                      <p className="py-6 text-sm text-Heres-muted">Loading your NFTs...</p>
                    ) : nftList.length === 0 ? (
                      <p className="rounded-xl border border-Heres-border bg-Heres-surface/50 px-4 py-6 text-sm text-Heres-muted">No NFTs found in this wallet.</p>
                    ) : (
                      <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-Heres-border bg-Heres-surface/50 p-3">
                        {nftList.map((nft) => (
                          <label
                            key={nft.mint}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-Heres-border bg-Heres-card/80 p-3 transition-colors hover:border-Heres-accent/30"
                          >
                            <input
                              type="checkbox"
                              checked={selectedNftMints.includes(nft.mint)}
                              onChange={() => toggleNftSelection(nft.mint)}
                              className="h-4 w-4 rounded border-Heres-border bg-Heres-surface text-Heres-accent focus:ring-Heres-accent"
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-sm text-Heres-white" title={nft.mint}>
                              {nft.mint.slice(0, 8)}...{nft.mint.slice(-8)}
                            </span>
                            {nft.name && <span className="max-w-[120px] truncate text-sm text-Heres-muted">{nft.name}</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    {selectedNftMints.length > 0 && (
                      <p className="mt-3 text-sm text-Heres-accent">{selectedNftMints.length} NFT(s) selected</p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteAsset ? 'Asset selection is ready. Continue to recipient setup.' : 'Choose the asset payload before continuing.'}
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setOpenSection('beneficiaries')}
                    disabled={!canCompleteAsset}
                  >
                    Continue
                  </Button>
                </div>
              </div>
          </ServiceAccordionSection>

          <ServiceAccordionSection
            step="Step 2"
            title="Beneficiary Information and Trigger Conditions"
            description="Enter recipient details, choose timing, and define when the capsule should execute."
            open={openSection === 'beneficiaries'}
            onToggle={() => setOpenSection((prev) => (prev === 'beneficiaries' ? 'intent' : 'beneficiaries'))}
          >
              <div className="space-y-4">
                {capsuleType === null && (
                  <div className="rounded-2xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                    Choose an asset type in Step 1 first. The beneficiary and trigger inputs will adapt to token or NFT flow automatically.
                  </div>
                )}
                {capsuleType === 'token' && (
                  <div className="space-y-4 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Beneficiaries</p>
                      {beneficiaries.length > 1 && (
                        <button type="button" onClick={splitEvenly} className="text-xs font-medium text-Heres-accent hover:underline">
                          Split evenly
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-Heres-muted">Each recipient receives a share of the vault. Shares split evenly by default and must total 100%; edit any field to rebalance.</p>

                    {beneficiaries.map((beneficiary, index) => {
                      const sharePct = parseFloat(beneficiary.amount) || 0
                      const total = parseFloat(totalAmount) || 0
                      const tokenAmount = total > 0 ? (total * sharePct) / 100 : 0
                      const addrError = beneficiary.address && !isValidBeneficiaryAddress(beneficiary) ? 'Invalid Solana address' : undefined
                      return (
                        <div key={beneficiary.id} className="space-y-2">
                          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                            <Field label={`Beneficiary ${index + 1} address`} error={addrError} className="min-w-0 flex-1">
                              <Input
                                type="text"
                                value={beneficiary.address}
                                onChange={(e) => updateBeneficiary(index, 'address', e.target.value.trim())}
                                placeholder="Solana address..."
                                className="font-mono"
                              />
                            </Field>
                            <div className="flex flex-shrink-0 items-center gap-2">
                              <div className="flex items-center rounded-xl border border-Heres-border bg-Heres-surface/80 focus-within:border-Heres-accent/50">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={beneficiary.amount}
                                  onChange={(e) => updateBeneficiary(index, 'amount', e.target.value)}
                                  placeholder="0"
                                  aria-label={`Share for beneficiary ${index + 1}`}
                                  className="w-16 bg-transparent p-3 text-right text-sm text-Heres-white placeholder-Heres-muted focus:outline-none"
                                />
                                <span className="pr-3 text-sm text-Heres-muted">%</span>
                              </div>
                              {beneficiaries.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeBeneficiary(index)}
                                  aria-label={`Remove beneficiary ${index + 1}`}
                                  className="rounded-xl border border-Heres-border p-3 text-red-400 transition-colors hover:bg-red-500/10"
                                >
                                  <X className="h-5 w-5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {beneficiary.address && sharePct > 0 && total > 0 && (
                            <p className="text-xs text-Heres-muted">
                              ~ <span className="font-semibold text-Heres-accent">{tokenAmount.toFixed(4)} {assetUnit}</span> ({sharePct}% of {total} {assetUnit})
                            </p>
                          )}
                        </div>
                      )
                    })}

                    {(() => {
                      const totalShare = Math.round(beneficiaries.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0) * 100) / 100
                      const ok = Math.abs(totalShare - 100) < 0.01
                      return (
                        <div className="flex items-center justify-between rounded-xl border border-Heres-border bg-Heres-surface/50 px-4 py-3 text-sm">
                          <span className="text-Heres-muted">Shares total</span>
                          <span className={ok ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                            {totalShare}%{ok ? '' : ' (must equal 100%)'}
                          </span>
                        </div>
                      )
                    })()}

                    <button
                      type="button"
                      onClick={addBeneficiary}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-Heres-border py-3 text-sm font-medium text-Heres-accent transition-colors hover:border-Heres-accent/50 hover:bg-Heres-accent/5"
                    >
                      <Plus className="h-5 w-5" />
                      Add Beneficiary
                    </button>
                  </div>
                )}

                {capsuleType === 'nft' && (
                  <div className="space-y-4 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">NFT Recipients</p>
                    {nftRecipients.map((r, i) => (
                      <div key={i} className="mb-2 flex items-center gap-2">
                        <Field label={`Recipient ${i + 1} address`} className="min-w-0 flex-1">
                          <Input
                            type="text"
                            value={r.address}
                            onChange={(e) => setNftRecipientAddress(i, e.target.value.trim())}
                            placeholder="Solana address..."
                            className="font-mono"
                          />
                        </Field>
                        {nftRecipients.length > 1 && (
                          <button type="button" onClick={() => removeNftRecipient(i)} className="rounded-lg border border-Heres-border p-2 text-red-400 hover:bg-red-500/10">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={addNftRecipient} className="mt-2 flex items-center gap-1 text-sm text-Heres-accent hover:underline">
                      <Plus className="h-4 w-4" /> Add recipient
                    </button>

                    {selectedNftMints.length > 0 && (
                      <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-Heres-accent">Which wallet receives which NFT</p>
                        <p className="mb-4 text-sm text-Heres-muted">Select the recipient for each NFT. When the capsule executes, each NFT will be sent to the selected wallet.</p>
                        <div className="space-y-3">
                          {selectedNftMints.map((mint) => (
                            <div key={mint} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                              <span className="min-w-[120px] truncate font-mono text-sm text-Heres-white sm:w-40" title={mint}>
                                NFT: {mint.slice(0, 8)}...{mint.slice(-8)}
                              </span>
                              <span className="shrink-0 text-Heres-muted">send to</span>
                              <Select
                                value={nftAssignments[mint] ?? 0}
                                onChange={(e) => setNftAssignment(mint, Number(e.target.value))}
                                className="min-w-0 flex-1"
                              >
                                {nftRecipients.map((r, i) => (
                                  <option key={i} value={i} className="bg-Heres-card text-Heres-white">
                                    {r.address.trim()
                                      ? `Recipient ${i + 1}: ${r.address.slice(0, 6)}...${r.address.slice(-4)}`
                                      : `Recipient ${i + 1} (enter address above)`}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          ))}
                        </div>
                        {!nftRecipients.some((r) => r.address.trim()) && (
                          <p className="mt-3 text-xs text-Heres-accent">Add at least one recipient address, then choose who receives each NFT here.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {capsuleType !== null && (
                  <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Trigger</p>
                    <p className="mb-4 text-sm text-Heres-muted">
                      The capsule fires after this long with no activity, measured from your last on-chain transaction.
                    </p>

                    {supportsMinuteMode && (
                      <div className="mb-3 inline-flex rounded-xl border border-Heres-border bg-Heres-surface/70 p-1">
                        <button
                          type="button"
                          onClick={() => setInactivityUnit('days')}
                          className={`rounded-lg px-4 py-2 text-sm transition ${inactivityUnit === 'days' ? 'bg-Heres-accent/15 text-Heres-accent' : 'text-Heres-muted hover:text-Heres-white'}`}
                        >
                          Days
                        </button>
                        <button
                          type="button"
                          onClick={() => setInactivityUnit('minutes')}
                          className={`rounded-lg px-4 py-2 text-sm transition ${inactivityUnit === 'minutes' ? 'bg-Heres-accent/15 text-Heres-accent' : 'text-Heres-muted hover:text-Heres-white'}`}
                        >
                          Minutes
                        </button>
                      </div>
                    )}

                    <div className="flex items-center rounded-xl border border-Heres-border bg-Heres-surface/80 focus-within:border-Heres-accent/50">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={inactivityDays}
                        onChange={(e) => setInactivityDays(e.target.value)}
                        placeholder={inactivityUnit === 'minutes' ? 'e.g. 5' : 'e.g. 365'}
                        aria-label="Inactivity period"
                        className="w-full bg-transparent p-4 text-Heres-white placeholder-Heres-muted focus:outline-none"
                      />
                      <span className="pr-4 text-sm text-Heres-muted">{inactivityUnit === 'minutes' ? 'minutes' : 'days'}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        { label: '30d', unit: 'days' as const, value: 30 },
                        { label: '90d', unit: 'days' as const, value: 90 },
                        { label: '1y', unit: 'days' as const, value: 365 },
                        ...(supportsMinuteMode ? [
                          { label: '1min', unit: 'minutes' as const, value: 1 },
                          { label: '5min', unit: 'minutes' as const, value: 5 },
                          { label: '10min', unit: 'minutes' as const, value: 10 },
                        ] : []),
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { setInactivityUnit(p.unit); setInactivityDays(String(p.value)) }}
                          className="rounded-lg border border-Heres-accent/30 bg-Heres-accent/10 px-3 py-1 text-xs text-Heres-accent hover:bg-Heres-accent/20"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <p className="mt-4 text-sm text-Heres-muted">
                      {inactivityDays && parseInt(inactivityDays, 10) > 0 ? (
                        <>
                          After <span className="font-semibold text-Heres-white">{formatInactivityLabel(inactivityDays, inactivityUnit)}</span> of inactivity
                          {approxFireDate ? <> (around <span className="font-semibold text-Heres-white">{approxFireDate}</span> if silent from today)</> : ''}, a fixed <span className="font-semibold text-Heres-white">48h grace</span> applies before assets are released.
                        </>
                      ) : (
                        'Set how long you can be inactive before the capsule fires.'
                      )}
                    </p>

                    <div className="mt-5 border-t border-Heres-border/60 pt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-Heres-white">Fire on a fixed date <span className="text-Heres-muted">(optional)</span></p>
                        {targetDate && (
                          <button
                            type="button"
                            onClick={() => setTargetDate('')}
                            className="text-xs text-Heres-muted hover:text-Heres-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="mb-3 mt-1 text-sm text-Heres-muted">
                        The capsule also fires on this date no matter how active you are. Whichever comes first - inactivity or this date - releases the assets.
                      </p>
                      <div className="flex items-center rounded-xl border border-Heres-border bg-Heres-surface/80 focus-within:border-Heres-accent/50">
                        <input
                          type="date"
                          value={targetDate}
                          min={minTargetDate}
                          onChange={(e) => setTargetDate(e.target.value)}
                          aria-label="Fixed fire date"
                          className="w-full bg-transparent p-4 text-Heres-white placeholder-Heres-muted focus:outline-none [color-scheme:dark]"
                        />
                      </div>
                      {targetDate && (
                        <p className="mt-2 text-sm text-Heres-muted">
                          Fires on <span className="font-semibold text-Heres-white">{new Date(targetDate + 'T00:00:00').toLocaleDateString()}</span> even if you stay active, then a fixed <span className="font-semibold text-Heres-white">48h grace</span> before release.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteBeneficiaries ? 'Recipients and trigger conditions are ready.' : 'Finish recipient and trigger setup before continuing.'}
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setOpenSection('intent')}
                    disabled={!canCompleteBeneficiaries}
                  >
                    Continue
                  </Button>
                </div>
              </div>
          </ServiceAccordionSection>

          <ServiceAccordionSection
            step="Step 3"
            title="Declare Your Intent"
            description="Describe your inheritance intent and executor notes. This is a support instruction, not a formal legal will."
            open={openSection === 'intent'}
            onToggle={() => setOpenSection((prev) => (prev === 'intent' ? 'review' : 'intent'))}
          >
              <div className="space-y-4">
                {capsuleType === null && (
                  <div className="rounded-2xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                    Select an asset type and configure the recipient flow first, then write the intent statement that accompanies the capsule.
                  </div>
                )}
                <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Intent Delivery</p>
                  <p className="mb-4 text-sm text-Heres-white">Choose who receives your intent statement once execution is confirmed. The statement is encrypted at rest and delivered to them by email - no access code to share or lose.</p>
                  <div className="space-y-4">
                    <Field
                      label="Representative Email"
                      error={intentEmail && !isValidEmail(intentEmail) ? 'Enter a valid email address' : undefined}
                    >
                      <Input
                        type="email"
                        value={intentEmail}
                        onChange={(e) => setIntentEmail(e.target.value)}
                        placeholder="executor@example.com"
                      />
                    </Field>
                    <label className="flex items-start gap-3 rounded-xl border border-Heres-border bg-Heres-card/40 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={intentReminderEnabled}
                        onChange={(e) => setIntentReminderEnabled(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-Heres-border bg-Heres-surface text-Heres-accent focus:ring-Heres-accent/40"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium text-Heres-white">Send recurring reminder emails before execution</span>
                        <span className="block text-xs text-Heres-muted">
                          Heres will email the representative about this capsule on a monthly cadence until it is executed or deactivated.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <Field label="Intent Statement">
                  <Textarea
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    placeholder="If I am inactive for one year, transfer my assets to my family, and delegate DAO permissions to my co-founder."
                    rows={5}
                  />
                </Field>
                <p className="text-xs text-amber-400">Do not put private keys, seed phrases, or master passwords in the intent statement.</p>

                {error && (
                  <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
                    Error: {error}
                  </div>
                )}
                {txHash && (
                  <div className="rounded-xl border border-Heres-accent/50 bg-Heres-accent/10 p-4 text-sm text-Heres-accent">
                    Capsule created. Transaction: {txHash}
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteIntent ? 'Intent package is ready for final review.' : 'Add the intent statement, representative email, and access code before continuing.'}
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setOpenSection('review')}
                    disabled={!canCompleteIntent}
                  >
                    Continue
                  </Button>
                </div>
              </div>
          </ServiceAccordionSection>

          <ServiceAccordionSection
            step="Step 4"
            title="Review & Create"
            description="Check readiness, privacy tier, fees, and then create the capsule."
            open={openSection === 'review'}
            onToggle={() => setOpenSection((prev) => (prev === 'review' ? 'intent' : 'review'))}
          >
              <div className="space-y-4">
                {capsuleType === null && (
                  <div className="rounded-2xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                    Review becomes actionable once the earlier steps are complete. Use it as the final launch point before creating the capsule.
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  <div className="space-y-3.5">
                    <div className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Shield className="h-4 w-4 text-Heres-accent" />
                        <span className="text-xs font-bold uppercase tracking-wider text-Heres-accent">Privacy Tier: PER (TEE)</span>
                      </div>
                      <p className="text-xs text-Heres-muted">
                        This capsule uses MagicBlock&apos;s Private Ephemeral Rollup so intent and trigger execution can remain confidential until conditions are met.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Readiness Checklist</p>
                      <div className="mt-4 space-y-3 text-sm">
                        {[
                          { label: 'Asset selected', ok: hasAssetSelection },
                          { label: 'Beneficiaries and timing configured', ok: hasBeneficiaryDetails },
                          { label: 'Intent statement written', ok: hasIntentDetails },
                          { label: 'Representative email valid', ok: isValidEmail(intentEmail) },
                        ].map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-Heres-border bg-Heres-card/50 px-4 py-3">
                            <span className="text-Heres-white">{item.label}</span>
                            <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${item.ok ? 'text-emerald-400' : 'text-Heres-muted'}`}>
                              {item.ok ? 'Ready' : 'Pending'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {existingCapsule && (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                        An active capsule already exists for this wallet. Creating a new one may require deactivation or execution of the current capsule first.
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Creation Summary</p>
                    <div className="mt-4 space-y-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Creation Fee</span>
                        <span className="font-semibold text-Heres-accent">{PLATFORM_FEE.CREATION_FEE_SOL} SOL</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Execution Fee</span>
                        <span className="font-semibold text-Heres-white">{PLATFORM_FEE.EXECUTION_FEE_BPS / 100}%</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Representative</span>
                        <span className="max-w-[180px] truncate font-medium text-Heres-white">{intentEmail || 'Pending'}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Reminder Emails</span>
                        <span className={`font-medium ${intentReminderEnabled ? 'text-Heres-accent' : 'text-Heres-muted'}`}>
                          {intentReminderEnabled ? 'Enabled' : 'Off'}
                        </span>
                      </div>
                      <div className="border-t border-Heres-border pt-4">
                        {error && (
                          <div className="mb-3 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
                            {error}
                          </div>
                        )}
                        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-300 space-y-1">
                          <p><span className="font-semibold">Irreversible action:</span> Once created, the capsule locks your funds on-chain. They cannot be recovered until the inactivity period or target date trigger fires.</p>
                          <p><span className="font-semibold">Multiple approvals required:</span> Your wallet will prompt you to sign several times: (1) create and fund the capsule, (2) delegate it to the TEE, (3) sign the TEE authentication token, and (4) set your beneficiaries inside the TEE. Approve each prompt in sequence.</p>
                        </div>
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={simulateExecution}
                          className="mb-3 w-full"
                        >
                          <Eye className="h-5 w-5" />
                          Simulate Execution
                        </Button>
                        <Button
                          variant="primary"
                          size="md"
                          onClick={handleCreate}
                          disabled={!isCreateReady}
                          loading={isPending}
                          className="w-full"
                        >
                          {isPending ? (currentStep || 'Creating capsule...') : 'Create Capsule'}
                        </Button>
                        <p className="mt-3 text-xs text-Heres-muted">
                          Final creation is enabled after all steps above are complete and your wallet can sign the encrypted payload.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          </ServiceAccordionSection>

          <section className="card-Heres p-5 sm:p-5">
            <h2 className="text-xl font-semibold text-Heres-white">FAQs</h2>
            <div className="mt-4 space-y-2.5">
              {CREATE_FAQS.map((faq) => (
                <div key={faq.key} className="overflow-hidden rounded-xl border border-Heres-border">
                  <button
                    type="button"
                    onClick={() => setOpenFaq((prev) => (prev === faq.key ? null : faq.key))}
                    className="flex w-full items-center justify-between gap-4 bg-Heres-card/50 px-4 py-4 text-left"
                  >
                    <span className="text-base font-medium text-Heres-white">{faq.question}</span>
                    {isFaqOpen(faq.key) ? <ChevronUp className="h-5 w-5 text-Heres-muted" /> : <ChevronDown className="h-5 w-5 text-Heres-muted" />}
                  </button>
                  {isFaqOpen(faq.key) && (
                    <div className="border-t border-Heres-border bg-Heres-surface/20 px-4 py-4 text-sm text-Heres-muted">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5">
              <p className="text-lg font-semibold text-Heres-white">Haven&apos;t Found Your Question?</p>
              <p className="mt-3 text-sm text-Heres-muted">Reach out through the official Heres community channels and support inbox if you need help finalizing your capsule flow.</p>
            </div>
          </section>

          {showSimulation && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
              <div className="card-Heres max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-8">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-Heres-white">Execution Simulation</h3>
                  <button onClick={() => setShowSimulation(false)} className="text-Heres-muted hover:text-Heres-white">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Intent</p>
                    <p className="text-Heres-white">{intent || 'No intent specified'}</p>
                  </div>
                  {capsuleType === 'token' && (
                    <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                      <p className="mb-2 text-xs text-Heres-accent">Beneficiaries</p>
                      <div className="space-y-2">
                        {beneficiaries.map((b) => (
                          <div key={b.id} className="flex justify-between gap-3 rounded-lg bg-Heres-card/80 p-2">
                            <p className="max-w-[200px] truncate font-mono text-sm text-Heres-white">
                              {b.address || 'Not set'}
                            </p>
                            <p className="text-sm font-semibold text-Heres-accent">{b.amount || '0'}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {capsuleType === 'nft' && (
                    <>
                      <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        <p className="mb-2 text-xs text-Heres-accent">Selected NFTs</p>
                        <div className="space-y-1">
                          {selectedNftMints.map((mint) => (
                            <p key={mint} className="truncate font-mono text-sm text-Heres-white">{mint.slice(0, 12)}...{mint.slice(-8)}</p>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        <p className="mb-2 text-xs text-Heres-accent">Recipients & assignment</p>
                        <div className="space-y-2">
                          {selectedNftMints.map((mint) => {
                            const idx = nftAssignments[mint] ?? 0
                            const addr = nftRecipients[idx]?.address ?? ''
                            return (
                              <div key={mint} className="flex items-center justify-between rounded-lg bg-Heres-card/80 p-2 text-sm">
                                <span className="max-w-[140px] truncate font-mono text-Heres-muted">{mint.slice(0, 6)}...{mint.slice(-6)}</span>
                                <span className="text-Heres-muted">→ send to</span>
                                <span className="max-w-[160px] truncate font-mono text-Heres-white">{addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : 'Not set'}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Trigger</p>
                    <p className="text-Heres-white">
                      After {formatInactivityLabel(inactivityDays, inactivityUnit) || '0 days'} of inactivity, a fixed 48h grace applies before assets are released.
                    </p>
                  </div>
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Intent Statement Delivery</p>
                    <p className="text-Heres-white">An encrypted intent statement package will be sent to {intentEmail || 'representative email'} when execution is confirmed.</p>
                  </div>
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Reminder Cadence</p>
                    <p className="text-Heres-white">
                      {intentReminderEnabled
                        ? `Monthly reminder emails will continue to ${intentEmail || 'the representative'} until the capsule executes or is deactivated.`
                        : 'Recurring reminder emails are disabled for this capsule.'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 p-4">
                    <p className="flex items-center gap-2 font-semibold text-Heres-accent">
                      <CheckCircle className="h-5 w-5" />
                      Execution would succeed
                    </p>
                    <p className="mt-1 text-sm text-Heres-muted">All conditions met. Capsule would execute automatically.</p>
                  </div>
                </div>
                <Button variant="primary" size="md" onClick={() => setShowSimulation(false)} className="mt-6 w-full">
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
