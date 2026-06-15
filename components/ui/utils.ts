import { clsx, type ClassValue } from 'clsx'

/**
 * Class-name composer for primitive variants. Thin wrapper over clsx so the
 * whole design system shares one helper instead of re-rolling a local cn().
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
