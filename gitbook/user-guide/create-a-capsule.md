# Create a Capsule

An Intent Capsule is an on-chain container for asset instructions. It stores the owner, inactivity period, last activity timestamp, encrypted intent metadata, active state, and execution state.

{% stepper %}
{% step %}
### Step 1: Connect Wallet

Open the Heres app and connect your Solana wallet. The connected wallet becomes the capsule owner. Only the owner can create the capsule and refresh its activity while it is active.
{% endstep %}

{% step %}
### Step 2: Choose Asset Type

Select the asset you want the capsule to manage.

Available paths depend on deployment configuration:

* **SOL**: native Solana asset support.
* **SPL token assets**: configured through token mint environment variables.
* **NFTs, RWAs (Future)**

For token capsules, enter the total amount to lock. For NFT capsules, select the NFT mints and assign recipients.
{% endstep %}

{% step %}
### Step 3: Add Beneficiaries

Add one or more beneficiaries.

For each beneficiary, provide:

* Destination chain type
* Wallet address
* Amount
* Amount type, either fixed or percentage
* Destination chain selector when using a cross-chain path

The app validates supported address formats and amount totals before allowing creation.
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

The representative is the email recipient for confidential delivery. Heres encrypts the statement in the browser, stores delivery metadata, and later dispatches delivery through Chainlink CRE after execution.
{% endstep %}

{% step %}
### Step 7: Choose Unlock Code

The unlock code is used during client-side encryption. The encrypted payload uses AES-GCM with key derivation. The plaintext statement should not be stored in normal backend application state.
{% endstep %}

{% step %}
### Step 8: Review and Confirm

Review:

* Asset type and amount
* Beneficiary addresses
* Inactivity period
* Representative email
* Estimated fees
* Network

Then confirm the transaction in your wallet. After confirmation, Heres shows a transaction signature and capsule detail link.
{% endstep %}
{% endstepper %}
