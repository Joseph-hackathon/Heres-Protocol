/** Cross-ER lifecycle phases advance only after the prior write is durable. */
export function isDurableErConfirmation(status: string | null | undefined): boolean {
  return status === 'finalized'
}
