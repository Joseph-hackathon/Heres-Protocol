import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import fs from 'fs'
import path from 'path'

// Configuration
const PROGRAM_ID_STR = 'CXVKwAjzQA95MPVyEbsMqSoFgHvbXAmSensTk6JJPKsM' // NEW PROGRAM ID
const MAGIC_BLOCK_DELEGATION_PID = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh'
const TEE_VALIDATOR = 'FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA'
const LOG_FILE = 'verification_log.txt'

function log(msg: string) {
    console.log(msg)
    fs.appendFileSync(LOG_FILE, msg + '\n')
}

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
const HELIUS_RPC = env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `https://devnet.helius-rpc.com/?api-key=${env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : 'https://api.devnet.solana.com'

async function main() {
    fs.writeFileSync(LOG_FILE, `Starting Verification at ${new Date().toISOString()}\n`)
    log("RPC: " + HELIUS_RPC)
    log("Program ID: " + PROGRAM_ID_STR)

    const connection = new Connection(HELIUS_RPC, 'confirmed')

    // Use Crank Wallet for testing
    const privateKey = env.CRANK_WALLET_PRIVATE_KEY
    if (!privateKey) {
        throw new Error('CRANK_WALLET_PRIVATE_KEY not found in .env.local')
    }
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
    const wallet = new Wallet(keypair)
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })

    // Load IDL
    const idlPath = path.join(process.cwd(), 'idl', 'HeresProgram.json')
    if (!fs.existsSync(idlPath)) {
        throw new Error(`IDL not found at ${idlPath}`)
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'))
    const program = new Program(idl as any, provider)

    log("Wallet: " + wallet.publicKey.toString())

    // 1. Check Balance
    const balance = await connection.getBalance(wallet.publicKey)
    log("Balance: " + (balance / 1e9) + " SOL")
    if (balance < 0.01 * 1e9) {
        log("Balance too low. Please fund " + wallet.publicKey.toString())
        // Continue anyway, might fail
    }

    // PDAs
    const [capsulePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('intent_capsule'), wallet.publicKey.toBuffer()],
        program.programId
    )
    const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('capsule_vault'), wallet.publicKey.toBuffer()],
        program.programId
    )
    const [feeConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config')],
        program.programId
    )

    // 1.5 Initialize Fee Config if needed
    log("Checking Fee Config...")
    const feeConfigAccount = await connection.getAccountInfo(feeConfigPDA)
    if (!feeConfigAccount) {
        log("Fee Config not initialized. Initializing...")
        try {
            const feeRecipient = new PublicKey(env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || wallet.publicKey)
            const tx = await program.methods
                .initFeeConfig(
                    feeRecipient,
                    new BN(50_000_000), // 0.05 SOL
                    300 // 3%
                )
                .accounts({
                    feeConfig: feeConfigPDA,
                    authority: wallet.publicKey,
                    systemProgram: SystemProgram.programId
                })
                .rpc()
            log("Fee Config Initialized! Tx: " + tx)
            await connection.confirmTransaction(tx)
        } catch (e: any) {
            log("Failed to init fee config: " + e.message)
            // Maybe it was race condition?
        }
    } else {
        log("Fee Config already exists.")
    }

    // 2. Create Capsule (or check if exists)
    log("Checking for existing capsule at: " + capsulePDA.toString())
    let capsuleAccount = await connection.getAccountInfo(capsulePDA)

    if (capsuleAccount) {
        log("Capsule already exists. Using existing capsule.")
        // If it's already delegated, we can't easily re-delegate without undelegating first
        if (capsuleAccount.owner.toBase58() === MAGIC_BLOCK_DELEGATION_PID) {
            log("Capsule is ALREADY delegated to MagicBlock.")
            log("Verification SUCCESS (It's already in the target state).")
            return
        }
    } else {
        log("Creating new capsule...")
        const intentData = Buffer.from(JSON.stringify({
            type: 'token',
            intent: 'Test Verification',
            totalAmount: '0.1',
            beneficiaries: [],
            inactivityDays: 1,
            delayDays: 0
        }))

        // Fee recipient
        const feeRecipient = new PublicKey(env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || wallet.publicKey)

        try {
            const tx = await program.methods
                .createCapsule(new BN(60), intentData) // 60 seconds inactivity
                .accounts({
                    capsule: capsulePDA,
                    vault: vaultPDA,
                    owner: wallet.publicKey,
                    feeConfig: feeConfigPDA,
                    platformFeeRecipient: feeRecipient,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                    mint: null as any,
                    sourceTokenAccount: null as any,
                    vaultTokenAccount: null as any
                })
                .rpc()
            log("Capsule Created! Tx: " + tx)
            // Wait for confirmation
            await connection.confirmTransaction(tx)
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                log("Capsule already created (race condition?). Proceeding.")
            } else {
                throw e
            }
        }
    }

    // Refresh account info
    capsuleAccount = await connection.getAccountInfo(capsulePDA)
    if (!capsuleAccount) throw new Error("Failed to fetch capsule after creation")

    if (capsuleAccount.owner.toBase58() !== PROGRAM_ID_STR) {
        throw new Error(`Capsule owner is ${capsuleAccount.owner.toBase58()}, expected Program ID ${PROGRAM_ID_STR}`)
    }
    log("Capsule is currently owned by Program. Proceeding to Delegate...")

    // 3. Delegate Capsule
    const delegationProgramId = new PublicKey(MAGIC_BLOCK_DELEGATION_PID)
    const magicProgramId = new PublicKey(env.NEXT_PUBLIC_MAGIC_PROGRAM_ID || 'MPUxHCpNUy3K1CSVhebAmTbcTCKVxfk9YMDcUP2ZnEA')

    // PDAs for Delegation
    // Note: buffer PDAs are derived from the OWNER PROGRAM (Heres), not Magic Program,
    // according to the IDL/Macro constraints.
    const [bufferPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("buffer"), capsulePDA.toBuffer()],
        program.programId // Was magicProgramId
    )
    const [delegationRecordPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), capsulePDA.toBuffer()],
        delegationProgramId
    )
    const [delegationMetadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation-metadata"), capsulePDA.toBuffer()],
        delegationProgramId
    )

    const [vaultBufferPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("buffer"), vaultPDA.toBuffer()],
        program.programId // Was magicProgramId
    )
    const [vaultDelegationRecordPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), vaultPDA.toBuffer()],
        delegationProgramId
    )
    const [vaultDelegationMetadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation-metadata"), vaultPDA.toBuffer()],
        delegationProgramId
    )

    try {
        const tx = await program.methods
            .delegateCapsule()
            .accounts({
                payer: wallet.publicKey,
                owner: wallet.publicKey,
                validator: new PublicKey(TEE_VALIDATOR),

                // Capsule PDA Delegation Accounts (Macro generated: prefix + field_name)
                bufferPda: bufferPDA,
                delegationRecordPda: delegationRecordPDA,
                delegationMetadataPda: delegationMetadataPDA,
                pda: capsulePDA,

                // Vault PDA Delegation Accounts
                bufferVault: vaultBufferPDA,
                delegationRecordVault: vaultDelegationRecordPDA,
                delegationMetadataVault: vaultDelegationMetadataPDA,
                vault: vaultPDA,

                magicProgram: magicProgramId,
                delegationProgram: delegationProgramId,
                systemProgram: SystemProgram.programId,
                ownerProgram: program.programId, // Required by IDL - the program that owns the PDAs
            })
            .rpc()

        log("Delegation Transaction Sent! Tx: " + tx)
        await connection.confirmTransaction(tx)

        // 4. Verify Delegation
        const delegatedAccount = await connection.getAccountInfo(capsulePDA)
        log("Capsule Owner after delegation: " + delegatedAccount?.owner.toBase58())

        if (delegatedAccount?.owner.toBase58() === MAGIC_BLOCK_DELEGATION_PID) {
            log("SUCCESS: Capsule is now owned by MagicBlock Delegation Program.")
        } else {
            console.error("FAILURE: Capsule owner mismatch.")
            log("FAILURE: Capsule owner mismatch.")
        }

    } catch (e) {
        console.error("Delegation Failed:", e)
        log("Delegation Failed: " + (e as any).message)
        throw e
    }
}

main().catch((e) => {
    console.error(e)
    log("Main Error: " + e.message)
})
