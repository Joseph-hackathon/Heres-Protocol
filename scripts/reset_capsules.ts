import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor'
import bs58 from 'bs58'
import fs from 'fs'
import path from 'path'

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

const idlPath = path.join(process.cwd(), 'idl', 'HeresProgram.json')
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'))

const PROGRAM_ID = new PublicKey('BiAB1qZpx8kDgS5dJxKFdCJDNMagCn8xfj4afNhRZWms')
const RPC_URL = env.SOLANA_RPC_URL ||
    (env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://solana-devnet.g.alchemy.com/v2/${env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : 'https://api.devnet.solana.com')

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const SYSTEM_PROGRAM_ID = SystemProgram.programId

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [
            owner.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
        ],
        SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    )[0]
}

async function resetExpiredCapsules() {
    const connection = new Connection(RPC_URL, 'confirmed')

    const privateKey = env.CRANK_WALLET_PRIVATE_KEY
    if (!privateKey) {
        console.error('CRANK_WALLET_PRIVATE_KEY not found')
        return
    }

    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
    const wallet = new Wallet(keypair)
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
    const program = new Program(idl as any, provider) as any

    console.log('Fetching all capsules...')
    const capsules = await program.account.intentCapsule.all()
    console.log(`Found ${capsules.length} capsules total.`)

    const now = Math.floor(Date.now() / 1000)
    const expiredCapsules = capsules.filter((c: any) => {
        const data = c.account
        const isExpired = Number(data.lastActivity) + Number(data.inactivityPeriod) < now
        return data.isActive && isExpired
    })

    console.log(`Found ${expiredCapsules.length} expired active capsules.`)

    for (const capsule of expiredCapsules) {
        const owner = capsule.account.owner
        const capsuleKey = capsule.publicKey
        console.log(`Processing capsule: ${capsuleKey.toString()} (Owner: ${owner.toString()})...`)

        // Check for delegation
        const accountInfo = await connection.getAccountInfo(capsuleKey)
        if (accountInfo && accountInfo.owner.toString() === 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh') {
            console.log(`Capsule ${capsuleKey.toString()} is DELEGATED. Skipping base layer execution.`)
            continue
        }

        try {
            const intentData = capsule.account.intentData as Buffer
            const json = Buffer.from(intentData).toString('utf8')
            const data = JSON.parse(json)
            const mint = capsule.account.mint // From new IDL

            const isSpl = mint && !mint.equals(PublicKey.default) && !mint.equals(SYSTEM_PROGRAM_ID)

            console.log(`Capsule type: ${isSpl ? 'SPL' : 'SOL'} (Mint: ${mint ? mint.toString() : 'None'})`)

            const beneficiaries = data.beneficiaries || []
            const remainingAccounts = beneficiaries.map((b: any) => {
                const beneficiaryOwner = new PublicKey(b.address)
                if (isSpl) {
                    const beneficiaryAta = getAssociatedTokenAddress(mint, beneficiaryOwner)
                    return {
                        pubkey: beneficiaryAta,
                        isSigner: false,
                        isWritable: true,
                    }
                } else {
                    return {
                        pubkey: beneficiaryOwner,
                        isSigner: false,
                        isWritable: true,
                    }
                }
            })

            const [capsulePDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('intent_capsule'), owner.toBuffer()],
                PROGRAM_ID
            )
            const [vaultPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('capsule_vault'), owner.toBuffer()],
                PROGRAM_ID
            )
            const [feeConfigPDA] = PublicKey.findProgramAddressSync(
                [Buffer.from('fee_config')],
                PROGRAM_ID
            )

            const platformFeeRecipient = new PublicKey(env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || 'Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')

            let vaultTokenAccount = null
            if (isSpl) {
                vaultTokenAccount = getAssociatedTokenAddress(mint, vaultPDA)
            }

            const tx = await program.methods
                .executeIntent()
                .accounts({
                    capsule: capsulePDA,
                    vault: vaultPDA,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    // @ts-ignore
                    vaultTokenAccount: vaultTokenAccount, // Optional in IDL
                    feeConfig: feeConfigPDA,
                    platformFeeRecipient: platformFeeRecipient,
                })
                .remainingAccounts(remainingAccounts)
                .rpc()

            console.log(`Successfully executed: ${tx}`)
        } catch (e: any) {
            console.error(`Failed to execute capsule for ${owner.toString()}:`, e.message)
        }
    }

    console.log('Done.')
}

resetExpiredCapsules().catch(console.error)
