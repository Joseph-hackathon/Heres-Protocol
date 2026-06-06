import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import anchor from '@coral-xyz/anchor'
import fs from 'fs'
const { Program, AnchorProvider, BN } = anchor

const idl = JSON.parse(fs.readFileSync(new URL('../idl/HeresProgram.json', import.meta.url), 'utf8'))
const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
// init_fee_config is gated on the program's upgrade authority (audit C3), so this MUST run as the
// deployer. Point HERES_AUTHORITY_KEYPAIR at the deploy wallet; defaults to the Solana CLI wallet.
const keypairPath = process.env.HERES_AUTHORITY_KEYPAIR || process.env.HOME + '/.config/solana/id.json'
const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf8'))
const wallet = Keypair.fromSecretKey(Uint8Array.from(secretKey))

class NodeWallet {
  payer: Keypair
  constructor(payer: Keypair) { this.payer = payer }
  get publicKey() { return this.payer.publicKey }
  async signTransaction(tx: any) { tx.partialSign(this.payer); return tx }
  async signAllTransactions(txs: any[]) { txs.forEach(tx => tx.partialSign(this.payer)); return txs }
}

async function main() {
  const provider = new AnchorProvider(connection, new NodeWallet(wallet), { commitment: 'confirmed' })
  const program = new Program(idl as any, provider)

  const [feeConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config')],
    program.programId
  )
  // ProgramData (BPF upgradeable loader) holds the upgrade authority. init_fee_config is now
  // gated on it so only the deployer can initialize the global fee config (audit C3).
  const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
  const [programData] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  )
  console.log('Program ID:', program.programId.toBase58())
  console.log('Fee Config PDA:', feeConfigPDA.toBase58())
  console.log('Program Data:', programData.toBase58())
  console.log('Authority (must be program upgrade authority):', wallet.publicKey.toBase58())

  const existing = await connection.getAccountInfo(feeConfigPDA)
  if (existing) {
    console.log('Fee Config already initialized!')
    return
  }

  const feeRecipient = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')
  const tx = await (program.methods as any)
    .initFeeConfig(
      feeRecipient,
      new BN(50_000_000), // 0.05 SOL creation fee
      300 // 3% execution fee
    )
    .accounts({
      feeConfig: feeConfigPDA,
      authority: wallet.publicKey,
      program: program.programId,
      programData,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  console.log('Fee Config initialized! Tx:', tx)
}

main().catch(console.error)
