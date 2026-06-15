import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './utils'
import { baseControl } from './Input'

/**
 * Native select with a custom chevron. Native keeps keyboard + mobile behavior
 * correct for free; we only restyle the chrome.
 */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(baseControl, 'appearance-none pr-9', className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash"
          aria-hidden
        />
      </div>
    )
  }
)
