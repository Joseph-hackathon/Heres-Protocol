# How Heres Protocol works

## The Assurance Pipeline

Heres Protocol operates on a precision-engineered **"Assurance Pipeline"** designed to protect a user's intent during their lifetime and execute it autonomously in their absence. We combine the speed of Solana, the security of Magicblock's Secure Enclave, and the interoperability of Chainlink to build a complete legacy transfer process.

### Step 01: Intent Definition & Capsule Creation

The first step in legacy protection is digitizing the user's intent.

* **Defining the Legacy**: Users define beneficiaries, asset allocation (%), and Heartbeat intervals via the dashboard.
* **Asset Lock-up**: Assets to be inherited (SOL, USDC, etc.) are deposited into a secure Capsule account controlled by Heres smart contracts. These assets remain under the user's self-sovereignty, modifiable or retrievable at any time while alive.
* **Program State Update**: All settings are recorded on-chain in the `CapsuleAccount` on Solana, ensuring transparency and immutability.

### Step 02: Isolated Privacy (Secure Enclave)

The strongest differentiator of Heres lies in how it protects the most sensitive information.

* **Confidential Intent Storage**: Secret messages and private instructions are encrypted within **Magicblock’s Secure Enclave**.
* **Zero-Access Policy**: This data is processed in a TEE environment that is completely isolated from any external access. No one, including the Heres team, node operators, or malicious hackers, can access or tamper with the data inside the enclave.
* **Execution Logic Protection**: The specific execution logic of the capsule is also secured within the enclave, guaranteeing the integrity of the payout process.

### Step 03: Continuous Monitoring (The Heartbeat)

Once a capsule is created, the protocol begins intelligently monitoring the user's activity.

* **Intelligent Heartbeat**: While users can manually click a 'Heartbeat' button on the dashboard, Heres also leverages Alchemy infrastructure to automatically refresh the heartbeat by detecting user wallet activity (e.g., transactions).
* **Multi-layered Alerting**: As the heartbeat cycle approaches expiration, the system sends notifications via email, app push, and on-chain alerts.
* **Grace Period**: The capsule does not execute immediately upon expiration. To account for accidental lapses or temporary absences, a final "Grace Period" is enforced.

### Step 04: Autonomous Execution & Payout

When a user's heartbeat remains silent through the end of the Grace Period, the pipeline concludes autonomously.

* **TEE Crank Trigger**: An autonomous "Crank" residing within the Secure Enclave verifies the conditions and triggers the execution transaction. No centralized server intervention is required.
* **Cross-chain Settlement**: Using Chainlink CCIP and CRE technology, assets (even those on other chains) are securely transferred to the designated beneficiaries.
* **Optimal Tax Capture**: By ensuring near-instant execution upon death, the capsule captures the precise timing for a "Stepped-up Basis," leading to significant tax savings for the heirs.

### Infrastructure Visualization

The core technology stack supporting Heres.

<table><thead><tr><th width="165">Component</th><th width="194">Technology</th><th>Role</th></tr></thead><tbody><tr><td><strong>Asset Layer</strong></td><td>Solana</td><td>High-performance asset transfer and smart contract execution</td></tr><tr><td><strong>Privacy Layer</strong></td><td>Magicblock (TEE)</td><td>Confidential data processing and autonomous execution in an isolated environment</td></tr><tr><td><strong>Messaging Layer</strong></td><td>Chainlink (CCIP/CRE)</td><td>Standardization of cross-chain asset movement and secure messaging</td></tr><tr><td><strong>Intelligence Layer</strong></td><td>Alchemy</td><td>Real-time on-chain data detection and heartbeat monitoring</td></tr></tbody></table>
