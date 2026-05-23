import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import fs from 'fs'
import path from 'path'

// Load Env
function loadEnv(): Record<string, string> {
    const envPath = path.join(process.cwd(), '.env.local')
    if (!fs.existsSync(envPath)) return {}
    const content = fs.readFileSync(envPath, 'utf8')
    const env: Record<string, string> = {}
    content.split('\n').forEach(line => {
        const parts = line.split('=')
        if (parts.length === 2) {
            env[parts[0].trim()] = parts[1].trim()
        }
    })
    return env
}

const env = loadEnv()
const RPC_URL = env.SOLANA_RPC_URL ||
    (env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://solana-devnet.g.alchemy.com/v2/${env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : 'https://api.devnet.solana.com')

async function main() {
    console.log("=== Updating Fee Config to Zero ===\n")

    const connection = new Connection(RPC_URL, 'confirmed')

    const privateKey = env.CRANK_WALLET_PRIVATE_KEY
    if (!privateKey) {
        throw new Error('CRANK_WALLET_PRIVATE_KEY not found in .env.local')
    }
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
    const wallet = new Wallet(keypair)
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })

    const idlPath = path.join(process.cwd(), 'idl', 'HeresProgram.json')
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'))
    const program = new Program(idl as any, provider)

    console.log("Program ID:", program.programId.toString())
    console.log("Authority:", wallet.publicKey.toString())

    const [feeConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config')],
        program.programId
    )

    console.log("Fee Config PDA:", feeConfigPDA.toString())

    try {
        console.log("\n📝 Updating fee config...")

        const tx = await program.methods
            .updateFeeConfig(
                new BN(0), // creation_fee_lamports = 0
                300 // execution_fee_bps = 3% (keep same)
            )
            .accounts({
                feeConfig: feeConfigPDA,
                authority: wallet.publicKey,
            })
            .rpc()

        console.log("✅ Update Transaction:", tx)
        await connection.confirmTransaction(tx)

        console.log("\n🎉 Success! Creation fee is now 0.")
        console.log("You can now create capsules without paying creation fees.")

    } catch (e: any) {
        console.error("Error:", e.message)
        if (e.logs) {
            console.log("\nError logs:")
            e.logs.forEach((log: string) => console.log("  ", log))
        }
        throw e
    }
}

main().catch(console.error)
