# FAQ

### What is Heres Protocol ?&#xD;

Heres Protocol is the world’s first autonomous 'Asset Protection and Inheritance Protocol' built on the Solana ecosystem.

By monitoring a user’s 'Autonomous Presence Signals' on-chain, the protocol solves the 'Digital Graveyard' problem. It autonomously transfers assets secured within our encrypted vaults to designated heirs in the event of the owner’s absence, ensuring that your digital wealth is never lost.

### Is Heres Protocol a wallet?&#xD;

Heres can connect to an existing Solana wallet or use a Privy embedded wallet. You keep control of the signing wallet. The wallet menu can send funds and lets a Privy embedded-wallet user open Privy's isolated key export flow.

### Does Heres custody my private keys?&#xD;

No. Heres Protocol will never ask for your seed phrase or private key. You sign all transactions safely using your own wallet.

### What happens if I become active again?

The owner can refresh their activity simply by making a normal on-chain transaction before the capsule executes. This automatically resets the inactivity timer (Silence Limit).

### Can anyone execute my capsule?&#xD;

After your designated inactivity period is met, the execution process becomes permissionless by design to guarantee delivery. However, the smart contract strictly enforces your original capsule rules, meaning assets can only ever be sent to the exact beneficiaries you pre-approved.

### Can beneficiaries change the capsule?&#xD;

No. Beneficiaries have absolutely no control over the capsule and cannot modify its rules unless they also hold the keys to the owner's wallet.

### What is the Capsule rule?

*  You can only create 1 capsule per wallet.
* The Create page redirects you to My Capsule while lifecycle accounts from an existing capsule still remain.
* While a capsule is active, the owner can refresh activity, add or withdraw funds, undelegate, or cancel it. New capsules do not allow beneficiary or NFT-assignment edits after the inheritance configuration is sealed during setup.
* Distribution and cancellation require the capsule switch and beneficiary data to be settled back on Solana first.
* After execution, distribute every asset and complete any enabled Intent Statement delivery before finalizing the capsule accounts. Finalization allows the wallet to create a fresh capsule.

### &#xD;What is the Intent Statement?

It is an encrypted, private final message or instruction that is securely delivered to your designated heir only after the capsule is successfully executed.

### What if delivery fails?

Asset delivery status is strictly monitored on-chain. If network congestion or an error causes a failure, the protocol's automated reconciliation engine will safely retry the transaction to ensure your heirs receive the assets without fail.

### Can I use Heres Protocol on Mainnet?

Heres Protocol is currently operating on Devnet/Testnet for rigorous stability testing. A full Mainnet release will be launched shortly after completing comprehensive security audits to guarantee the highest level of safety for your assets.

### What fees apply?&#xD;

Creating a Capsule requires a small one-time setup fee to cover the smart contract deployment, plus a minimal network transaction fee (gas fee) on the Solana network to power the monitoring oracle. Heres Protocol does not charge any percentage-based AUM (Assets Under Management) fees on the total value of the assets you lock.

### Do my beneficiaries need to sign up for Heres in advance?

No. Your beneficiaries do not need to know about Heres Protocol or create an account beforehand. As long as you provide their valid wallet addresses during setup, the smart contract will automatically push the assets to their wallets when the trigger conditions are met.

### Will my staked assets continue to earn yield while locked in the Capsule?

Yes. If you deposit Yield-bearing assets like Liquid Staking Tokens (e.g., JitoSOL, mSOL), they will continue to accrue staking rewards naturally while sitting securely in your Vault. Heres does not interfere with the underlying yield generation.

### Is Heres legal estate planning?

No. Heres is a decentralized software infrastructure, not a law firm. While it mathematically guarantees the transfer of digital assets, users should always consult qualified legal and tax professionals for formal estate planning.
