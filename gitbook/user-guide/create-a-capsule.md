# Create a Capsule

An Intent Capsule is an on-chain container for asset instructions. It stores the owner, inactivity period, last activity timestamp, active state, execution state, and beneficiary routing. Confidential Intent Statement delivery is registered separately.

{% stepper %}
{% step %}
### Step 1: Connect Wallet

Open the Heres app and connect your Solana wallet. The connected wallet becomes the capsule owner. Only the owner can create the capsule and refresh its activity while it is active.
{% endstep %}

{% step %}
### Step 2: Choose Assets

Choose either fungible assets or NFTs.

For a fungible capsule, select up to eight wallet-held assets:

* **SOL**: native Solana asset support.
* **Classic SPL tokens**: any supported mint held in the connected wallet's canonical token account.
* **Token-2022 tokens**: any supported mint held in the connected wallet's canonical token account.

Enter an exact amount for each selected fungible asset. The app keeps a SOL reserve for the creation fee, account rent, and transaction fees. For an NFT capsule, select standard Solana NFT mints and assign one recipient to each mint.
{% endstep %}

{% step %}
### Step 3: Add Beneficiaries

Add one or more beneficiaries.

For each beneficiary, provide:

* Solana wallet address
* Percentage share

Shares must total 100 percent. The same percentage split applies independently to every fungible asset selected in Step 2. The app validates addresses, duplicate entries, amount precision, wallet balances, and share totals before requesting a wallet signature.
{% endstep %}

{% step %}
### Step 4: Set Inactivity Period

Choose how long Heres should wait after your last activity before the capsule becomes eligible for execution.

The default configuration uses days. Devnet may expose minute-based testing so teams can verify the full lifecycle quickly.
{% endstep %}

{% step %}
### Step 5: Write Intent Statement

The Intent Statement is a private human-readable message for the representative. It can include instructions, recovery notes, or context that should only be delivered after execution.

Do not put plain private keys, seed phrases, or production secrets into any test deployment unless you fully understand the security model and operational controls.
{% endstep %}

{% step %}
### Step 6: Add Representative Email

The representative is the email recipient for confidential delivery. Heres authorizes registration with a wallet signature, encrypts the statement at rest in the delivery service, and later dispatches delivery through Chainlink CRE after execution.
{% endstep %}

{% step %}
### Step 7: Authorize Intent Delivery

Sign the intent registration message with the connected wallet. This proves the request came from the capsule owner without exposing the wallet's private key.
{% endstep %}

{% step %}
### Step 8: Review and Confirm

Review:

* Every selected asset and amount
* Beneficiary addresses and percentage shares
* Inactivity period
* Representative email
* Estimated fees
* Network

Then confirm the transaction in your wallet. After confirmation, Heres shows a transaction signature and capsule detail link.

The setup workflow performs several ordered actions:

* Creates an inactive Switch draft, private BeneficiarySet, and base-layer Vault.
* Deposits the selected assets into the Vault.
* Delegates the Switch to a regular ER and the BeneficiarySet to the permissioned TEE.
* Writes and seals the beneficiary and NFT configuration in the TEE.
* Arms the Switch with the matching commitment and schedules automatic execution.

Review carefully before signing. Once the private configuration is sealed, the program rejects beneficiary and NFT-assignment edits. If setup stops before arming, **My Capsule** shows a draft that can be undelegated and cancelled before trying again.
{% endstep %}
{% endstepper %}
