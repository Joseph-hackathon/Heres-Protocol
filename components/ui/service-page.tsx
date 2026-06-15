import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function SectionEyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-Heres-border/80 bg-Heres-card/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-Heres-muted',
        className
      )}
    >
      {children}
    </span>
  )
}

export function ServicePageHeader({
  eyebrow,
  title,
  description,
  statusLine,
  badges,
  actions,
  aside,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  statusLine?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('service-page-hero p-6 sm:p-8', className)}>
      <div className={cn('relative z-10 grid gap-6', Boolean(aside) && 'lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.85fr)] lg:items-start')}>
        <div>
          {eyebrow && <div>{eyebrow}</div>}
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[1.95rem] font-semibold tracking-tight text-Heres-white sm:text-[2.35rem]">
                {title}
              </h1>
              {description && (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-Heres-muted">
                  {description}
                </p>
              )}
              {statusLine && (
                <p className="mt-3 text-sm font-medium text-Heres-accent/90">{statusLine}</p>
              )}
              {badges && <div className="mt-4 flex flex-wrap gap-2">{badges}</div>}
            </div>
            {actions && (
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {actions}
              </div>
            )}
          </div>
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </section>
  )
}

export function ServiceMetaGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</section>
}

export function ServiceMetaCard({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('service-meta-card', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">{label}</p>
      {children}
    </div>
  )
}

export function ServiceSection({
  title,
  description,
  children,
  className,
  contentClassName,
  tone = 'default',
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  tone?: 'default' | 'accent' | 'warning'
}) {
  const toneClassName =
    tone === 'accent'
      ? 'border-Heres-accent/20'
      : tone === 'warning'
        ? 'border-amber-500/30'
        : ''

  return (
    <section className={cn('card-Heres p-6', toneClassName, className)}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-Heres-white">{title}</h2>
        {description ? <p className="mt-2 text-sm text-Heres-muted">{description}</p> : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  )
}

export function ServiceAccordionSection({
  step,
  title,
  description,
  open,
  onToggle,
  children,
  className,
}: {
  step: ReactNode
  title: ReactNode
  description?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('card-Heres overflow-hidden', className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-Heres-accent/80">{step}</p>
          <h2 className="mt-1 text-[1.05rem] font-semibold text-Heres-white">{title}</h2>
          {description ? <p className="mt-1 text-[13px] text-Heres-muted">{description}</p> : null}
        </div>
        <div className="text-Heres-muted">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
      </button>
      {open ? (
        <div className="border-t border-Heres-border px-5 pb-4 pt-3 sm:px-6">{children}</div>
      ) : null}
    </section>
  )
}
