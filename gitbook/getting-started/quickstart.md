---
description: User Flow
---

# Quickstart

Protecting your assets through Heres Protocol is designed to be intuitive. If you are new to the protocol, simply follow the step-by-step flow below to create your Capsule.

{% stepper %}
{% step %}
### **Connect Wallet & Authenticate**

Access the Heres dApp and connect your wallet (e.g., Phantom). This wallet will serve as the baseline for generating your Heartbeat signals.
{% endstep %}

{% step %}
### **Initialize a New Capsule**

Click the 'Create Capsule' button on the dashboard to initialize a new inheritance/protection contract.
{% endstep %}

{% step %}
### **Deposit Assets**

For a fungible capsule, select up to eight wallet-held assets across SOL, classic SPL, and Token-2022, then enter an exact amount for each asset. You can add another supported mint later from **My Capsule**. Assets can be withdrawn by you, the owner, while the capsule is active.
{% endstep %}

{% step %}
### **Configure Heirs & Rules**

Enter the Solana wallet addresses of the beneficiaries and their percentage weights. The weights total 100 percent and apply to every selected fungible asset. Carefully decide the 'Silence Limit' (how long wallet inactivity will trigger the Capsule).
{% endstep %}

{% step %}
### **Sign & Activate**

Review every asset, beneficiary, NFT assignment, and distribution weight before signing. Creation first builds an inactive draft, then writes and seals the private settlement configuration in the TEE. The final activation step arms the liveness Switch with the matching commitment and schedules monitoring. Settlement rules cannot be edited after sealing.
{% endstep %}
{% endstepper %}
