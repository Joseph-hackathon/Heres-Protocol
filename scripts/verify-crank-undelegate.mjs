/**
 * Verify production crank_undelegate round-trip (path used by lib/solana.ts undelegateCapsule)
 * create -> delegate (.methods) -> crank_undelegate on ER -> ownership returns to base layer
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN } = anchor;
import bs58 from 'bs58';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('./idl/HeresProgram.json', 'utf-8'));
const PROGRAM_ID = new PublicKey('AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW');
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');
const BUFFER_SEED_PROGRAM_ID = PROGRAM_ID;
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const ACTIVE_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PLATFORM_FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb');

const crankKp = Keypair.fromSecretKey(bs58.decode(process.env.CRANK_WALLET_PRIVATE_KEY));
const ownerKp = Keypair.generate();
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const erConn = new Connection('https://devnet-as.magicblock.app', 'confirmed');
class W { constructor(p){this.payer=p;} get publicKey(){return this.payer.publicKey;} async signTransaction(tx){tx.partialSign(this.payer);return tx;} async signAllTransactions(txs){txs.forEach(t=>t.partialSign(this.payer));return txs;} }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const [capsulePDA] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [feeConfigPDA] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID);
const [permissionPDA] = PublicKey.findProgramAddressSync([Buffer.from('permission'), capsulePDA.toBuffer()], PERMISSION_PROGRAM_ID);
const [bufferPDA] = PublicKey.findProgramAddressSync([Buffer.from('buffer'), capsulePDA.toBuffer()], BUFFER_SEED_PROGRAM_ID);
const [delegationRecordPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), capsulePDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadataPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), capsulePDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [vaultBufferPDA] = PublicKey.findProgramAddressSync([Buffer.from('buffer'), vaultPDA.toBuffer()], BUFFER_SEED_PROGRAM_ID);
const [vaultDelegationRecordPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [vaultDelegationMetadataPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);

let passed=0, failed=0;
const assert=(c,l)=>{ if(c){console.log(`  [PASS] ${l}`);passed++;}else{console.log(`  [FAIL] ${l}`);failed++;} };

console.log('Owner:', ownerKp.publicKey.toBase58());
await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({fromPubkey:crankKp.publicKey,toPubkey:ownerKp.publicKey,lamports:Math.floor(0.1*LAMPORTS_PER_SOL)})),[crankKp]);
console.log('Step 1: owner funded');

const ownerProv = new AnchorProvider(conn, new W(ownerKp), {commitment:'confirmed'});
idl.address = PROGRAM_ID.toBase58();
const ownerProg = new Program(idl, ownerProv);
const intent = JSON.stringify({intent:'undelegate-test',beneficiaries:[{address:crankKp.publicKey.toBase58(),amount:'100',amountType:'percentage'}],totalAmount:'0.003',inactivityDays:0,delayDays:0});
await ownerProg.methods.createCapsule(new BN(5), Buffer.from(intent)).accounts({
  owner:ownerKp.publicKey, capsule:capsulePDA, vault:vaultPDA, feeConfig:feeConfigPDA, platformFeeRecipient:PLATFORM_FEE_RECIPIENT,
  systemProgram:SystemProgram.programId, tokenProgram:TOKEN_PROGRAM_ID, mint:PROGRAM_ID, sourceTokenAccount:PROGRAM_ID, vaultTokenAccount:PROGRAM_ID,
  associatedTokenProgram:ASSOC_TOKEN_PROGRAM_ID, permissionProgram:PERMISSION_PROGRAM_ID, permission:permissionPDA,
}).signers([ownerKp]).rpc();
console.log('Step 2: capsule created');
await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({fromPubkey:ownerKp.publicKey,toPubkey:vaultPDA,lamports:Math.floor(0.003*LAMPORTS_PER_SOL)})),[ownerKp]);
console.log('Step 3: vault funded');

await ownerProg.methods.delegateCapsule().accounts({
  payer:ownerKp.publicKey, owner:ownerKp.publicKey, validator:ACTIVE_VALIDATOR,
  pda:capsulePDA, pdaBuffer:bufferPDA, pdaDelegationRecord:delegationRecordPDA, pdaDelegationMetadata:delegationMetadataPDA,
  vault:vaultPDA, vaultBuffer:vaultBufferPDA, vaultDelegationRecord:vaultDelegationRecordPDA, vaultDelegationMetadata:vaultDelegationMetadataPDA,
  magicProgram:MAGIC_PROGRAM_ID, delegationProgram:DELEGATION_PROGRAM_ID, systemProgram:SystemProgram.programId,
}).signers([ownerKp]).rpc();
await sleep(3000);
const di = await conn.getAccountInfo(capsulePDA);
assert(di?.owner.equals(DELEGATION_PROGRAM_ID), 'Step 4: capsule delegated to ER');

// crank_undelegate (production path)
const disc = idl.instructions.find(i=>i.name==='crank_undelegate'||i.name==='crankUndelegate')?.discriminator;
const ix = new TransactionInstruction({
  keys:[
    {pubkey:ownerKp.publicKey,isSigner:true,isWritable:true},
    {pubkey:capsulePDA,isSigner:false,isWritable:true},
    {pubkey:vaultPDA,isSigner:false,isWritable:true},
    {pubkey:MAGIC_CONTEXT_ID,isSigner:false,isWritable:true},
    {pubkey:MAGIC_PROGRAM_ID,isSigner:false,isWritable:false},
  ], programId:PROGRAM_ID, data:Buffer.from(disc),
});
const {blockhash,lastValidBlockHeight}=await erConn.getLatestBlockhash('confirmed');
const tx=new Transaction({feePayer:ownerKp.publicKey,blockhash,lastValidBlockHeight}); tx.add(ix); tx.sign(ownerKp);
const sig=await erConn.sendRawTransaction(tx.serialize(),{skipPreflight:true});
await erConn.confirmTransaction({signature:sig,blockhash,lastValidBlockHeight},'confirmed');
const txInfo=await erConn.getTransaction(sig,{maxSupportedTransactionVersion:0});
if(txInfo?.meta?.err){ console.log('  crank_undelegate err:',JSON.stringify(txInfo.meta.err)); txInfo?.meta?.logMessages?.slice(-8).forEach(l=>console.log('   ',l)); }
assert(!txInfo?.meta?.err, `Step 5: crank_undelegate sent: ${sig.slice(0,16)}...`);

// wait for base-layer ownership to return to program
let back=false;
for(let i=0;i<12;i++){ await sleep(2500); const info=await conn.getAccountInfo(capsulePDA); if(info?.owner.equals(PROGRAM_ID)){back=true;break;} }
assert(back, 'Step 6: capsule ownership returned to Heres program on base layer');

console.log(`\n===== ${passed} passed, ${failed} failed =====`);
process.exit(failed>0?1:0);
