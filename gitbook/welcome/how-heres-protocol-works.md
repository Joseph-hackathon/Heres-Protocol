---
description: 'Protocol Mechanics: Continuous Monitoring and Automated Distribution'
---

# How Heres Protocol works

Heres Protocol monitors your routine on-chain activity to determine your liveness, and only moves your assets according to strictly controlled procedures when specific conditions are met.&#x20;

The entire lifecycle consists of 3 straightforward steps:

{% stepper %}
{% step %}
### **Setup & Encapsulation**

You create a unique, personal smart contract Vault on the protocol and deposit the assets you want to protect.

You "encapsulate" these assets by setting the wallet addresses of your Heirs, the distribution weights, and a 'Silence Limit' the threshold that determines your absence.
{% endstep %}

{% step %}
### **Liveness Monitoring (Passive Heartbeat)**

Once the Capsule is active, the protocol continuously observes your main wallet for on-chain transactions (swaps, staking, simple transfers, etc.).

We call this a **Passive Heartbeat**. You don't need to press any manual "I'm alive" buttons; simply using your wallet as you normally do will extend the safety of your vault.
{% endstep %}

{% step %}
### **Trigger & Distribution**

If not a single valid transaction occurs from your wallet within the Silence Limit you set, the protocol considers you absent.&#x20;

After passing a short Grace Window for final verification, the smart contract automatically unlocks and safely distributes your assets to your designated heirs according to your exact preset ratios.&#x20;
{% endstep %}
{% endstepper %}

{% hint style="info" %}
Create Capsule now: [https://www.heresprotocol.com/create](https://www.heresprotocol.com/create)
{% endhint %}
