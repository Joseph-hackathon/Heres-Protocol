import { forwardRef } from 'react'
import { cn } from './utils'
import { baseControl } from './Input'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(baseControl, 'resize-y leading-6', className)} {...props} />
  }
)
