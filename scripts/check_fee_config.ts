import { Connection, PublicKey, Keypair } from "@solana/web3.js"
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor"
import * as fs from "fs"
import * as path from "path"
import bs58 from "bs58"

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
    const connection = new Connection(RPC_URL, "confirmed")
    const privateKey = env.CRANK_WALLET_PRIVATE_KEY
    if (!privateKey) {
        throw new Error('CRANK_WALLET_PRIVATE_KEY not found in .env.local')
    }
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
    const wallet = new Wallet(keypair)
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" })

    const idlPath = path.join(process.cwd(), 'idl', 'HeresProgram.json')
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'))
    const program = new Program(idl as any, provider)

    console.log("Program ID:", program.programId.toBase58())

    // Get fee config PDA
    const [feeConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("fee_config")],
        program.programId
    )

    console.log("Fee Config PDA:", feeConfigPDA.toBase58())

    try {
        const feeConfig = await program.account.feeConfig.fetch(feeConfigPDA)
        console.log("\nFee Config:")
        console.log("  Authority:", feeConfig.authority.toBase58())
        console.log("  Fee Recipient:", feeConfig.feeRecipient.toBase58())
        console.log("  Creation Fee (lamports):", feeConfig.creationFeeLamports.toString())
        console.log("  Execution Fee (bps):", feeConfig.executionFeeBps)

        console.log("\nExpected Platform Fee Recipient from constants:")
        console.log("  ", env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || 'Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')

        const expectedRecipient = env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || 'Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb'
        if (feeConfig.feeRecipient.toBase58() !== expectedRecipient) {
            console.log("\n⚠️  MISMATCH DETECTED!")
            console.log("Fee config has:", feeConfig.feeRecipient.toBase58())
            console.log("Client expects:", expectedRecipient)
        } else {
            console.log("\n✅ Fee recipient matches!")
        }

    } catch (e: any) {
        console.error("Error fetching fee config:", e.message)
        console.log("\nFee config might not be initialized yet.")
    }
}

main().catch(console.error)
