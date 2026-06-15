/**
 * Single home for explorer links. The implementation already lives in
 * `@/constants`; this module re-exports it under the documented `lib/explorer`
 * path so design-system primitives import from one place.
 */
export { getExplorerUrl, getNetworkDisplayLabel } from '@/constants'
