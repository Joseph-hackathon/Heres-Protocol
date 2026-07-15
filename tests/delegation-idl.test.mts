import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

type IdlAccount = {
  name: string
  address?: string
}

type IdlInstruction = {
  name: string
  accounts: IdlAccount[]
}

const idl = JSON.parse(
  readFileSync(new URL('../idl/heres_program.json', import.meta.url), 'utf8')
) as { instructions: IdlInstruction[] }

for (const instructionName of ['delegate_capsule', 'delegate_beneficiaries']) {
  test(`${instructionName} does not require the ER-only Magic Program on base layer`, () => {
    const instruction = idl.instructions.find(({ name }) => name === instructionName)
    assert.ok(instruction, `${instructionName} must exist in the IDL`)

    const magicProgram = instruction.accounts.find(({ name }) => name === 'magic_program')
    assert.ok(magicProgram, `${instructionName} must retain the stable magic_program ABI account`)
    assert.equal(
      magicProgram.address,
      undefined,
      `${instructionName} must accept the non-executable base-layer Magic Program placeholder`
    )
  })
}
