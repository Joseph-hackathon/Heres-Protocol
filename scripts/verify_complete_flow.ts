import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js"
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor"
import * as fs from "fs"
import idl from "../idl/heres_program.json"

const RPC_URL = process.env.SOLANA_RPC_URL || "https://devnet.helius-rpc.com/?api-key=a393269c-0295-485d-ba5f-0c8ffc828d0d"
const TEE_VALIDATOR = "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA"
const MAGIC_BLOCK_DELEGATION_PID = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"

// MagicBlock constants
const MAGICBLOCK_ER = {
    MAGIC_PROGRAM_ID: "Magic11111111111111111111111111111111111111",
    DELEGATION_PROGRAM_ID: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
    TEE_RPC_URL: "https://devnet.magicblock.app/rpc/tee",
}

const CRANK_DEFAULT_INTERVAL_MS = 10000 // 10 seconds
const CRANK_DEFAULT_ITERATIONS = 100

function log(message: string) {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] ${message}\n`
    console.log(logMessage.trim())
    fs.appendFileSync("verification_complete_log.txt", logMessage)
}

async function main() {
    log("=== Starting Complete Flow Verification ===")

    // Setup
    const connection = new Connection(RPC_URL, "confirmed")

    // Try different wallet paths for Windows/WSL compatibility
    let walletPath = process.env.HOME + "/.config/solana/id.json"
    if (!fs.existsSync(walletPath)) {
        walletPath = "/home/test/.config/solana/id.json" // WSL path
    }

    const wallet = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    )

    const walletAdapter = {
        publicKey: wallet.publicKey,
        signTransaction: async (tx: any) => { tx.sign([wallet]); return tx },
        signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign([wallet])); return txs },
    } as Wallet

    const provider = new AnchorProvider(connection, walletAdapter, { commitment: "confirmed" })
    const program = new Program(idl as any, provider)

    log(`Program ID: ${program.programId.toBase58()}`)
    log(`Wallet: ${wallet.publicKey.toBase58()}`)
    log(`Balance: ${await connection.getBalance(wallet.publicKey) / 1e9} SOL`)

    // 1. Get PDAs
    const [capsulePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("intent_capsule"), wallet.publicKey.toBuffer()],
        program.programId
    )
    const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("capsule_vault"), wallet.publicKey.toBuffer()],
        program.programId
    )
    const [feeConfigPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("fee_config")],
        program.programId
    )

    log(`Capsule PDA: ${capsulePDA.toBase58()}`)
    log(`Vault PDA: ${vaultPDA.toBase58()}`)

    // 2. Check if capsule exists
    const capsuleAccount = await connection.getAccountInfo(capsulePDA)
    log(`Capsule exists: ${capsuleAccount !== null}`)
    log(`Capsule owner: ${capsuleAccount?.owner.toBase58() || "N/A"}`)

    // 3. Delegate if not already delegated
    if (capsuleAccount?.owner.toBase58() !== MAGIC_BLOCK_DELEGATION_PID) {
        log("\n=== Step 1: Delegating Capsule to Ephemeral Rollup ===")

        const magicProgramId = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
        const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)

        // Capsule delegation accounts
        const [bufferPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("buffer"), capsulePDA.toBuffer()],
            program.programId
        )
        const [delegationRecordPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("delegation"), capsulePDA.toBuffer()],
            delegationProgramId
        )
        const [delegationMetadataPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("delegation-metadata"), capsulePDA.toBuffer()],
            delegationProgramId
        )

        // Vault delegation accounts
        const [vaultBufferPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("buffer"), vaultPDA.toBuffer()],
            program.programId
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
                    bufferPda: bufferPDA,
                    delegationRecordPda: delegationRecordPDA,
                    delegationMetadataPda: delegationMetadataPDA,
                    pda: capsulePDA,
                    bufferVault: vaultBufferPDA,
                    delegationRecordVault: vaultDelegationRecordPDA,
                    delegationMetadataVault: vaultDelegationMetadataPDA,
                    vault: vaultPDA,
                    magicProgram: magicProgramId,
                    delegationProgram: delegationProgramId,
                    systemProgram: SystemProgram.programId,
                    ownerProgram: program.programId,
                })
                .rpc()

            log(`✅ Delegation TX: ${tx}`)
            await connection.confirmTransaction(tx)

            // Verify delegation
            const delegatedAccount = await connection.getAccountInfo(capsulePDA)
            log(`Capsule owner after delegation: ${delegatedAccount?.owner.toBase58()}`)

            if (delegatedAccount?.owner.toBase58() === MAGIC_BLOCK_DELEGATION_PID) {
                log("✅ SUCCESS: Capsule delegated to MagicBlock")
            } else {
                log("❌ FAILURE: Delegation failed")
                return
            }
        } catch (e: any) {
            log(`❌ Delegation error: ${e.message}`)
            throw e
        }
    } else {
        log("✅ Capsule already delegated to MagicBlock")
    }

    // 4. Schedule crank task on TEE
    log("\n=== Step 2: Scheduling Crank Task on TEE ===")

    // Connect to TEE endpoint
    const teeConnection = new Connection(MAGICBLOCK_ER.TEE_RPC_URL, "confirmed")
    const teeProvider = new AnchorProvider(teeConnection, walletAdapter, { commitment: "confirmed" })
    const teeProgram = new Program(idl as any, teeProvider)

    const taskId = new BN(Date.now())
    const executionIntervalMillis = new BN(CRANK_DEFAULT_INTERVAL_MS)
    const iterations = new BN(CRANK_DEFAULT_ITERATIONS)

    const magicProgram = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)

    try {
        const tx = await teeProgram.methods
            .scheduleExecuteIntent({
                task_id: taskId,
                execution_interval_millis: executionIntervalMillis,
                iterations: iterations,
            })
            .accounts({
                magicProgram,
                payer: wallet.publicKey,
                capsule: capsulePDA,
                vault: vaultPDA,
                systemProgram: SystemProgram.programId,
                tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
                feeConfig: feeConfigPDA,
                platformFeeRecipient: wallet.publicKey,
                vaultTokenAccount: null,
            })
            .rpc()

        log(`✅ Scheduling TX: ${tx}`)
        log(`Task ID: ${taskId.toString()}`)
        log(`Interval: ${executionIntervalMillis.toNumber()}ms`)
        log(`Iterations: ${iterations.toString()}`)

        log("\n✅ Complete flow verification successful!")
        log("The crank task is now scheduled on the TEE and should execute automatically.")

    } catch (e: any) {
        log(`❌ Scheduling error: ${e.message}`)
        if (e.logs) {
            log("Error logs:")
            e.logs.forEach((l: string) => log(`  ${l}`))
        }
        throw e
    }

    log("\n=== Verification Complete ===")
}

main().catch((e) => {
    console.error(e)
    log(`Fatal error: ${e.message}`)
})
