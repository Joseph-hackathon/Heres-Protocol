---
description: Detailed Guide to Capsule Parameters
---

# Capsule Creation Details

The information you input during Capsule creation is the most critical data that dictates the future of your assets. Here are the exact definitions of each parameter:



* **Beneficiaries:** The final destination addresses that will receive the assets. You can designate one or multiple beneficiaries. New capsules write this list to a permissioned MagicBlock TEE, seal it with a private salt, and arm the public liveness Switch with only a matching commitment. The list is revealed to Solana only after the capsule fires so settlement can be verified.



* **Distribution Weight:** If you designate multiple beneficiaries, you set how the total deposited assets will be divided out of 100% (e.g., Spouse 70%, Child 30%). The protocol will split and transfer the transactions with pinpoint accuracy according to these ratios, down to the decimal.

  Confirm every address and weight before activation. The on-chain program rejects changes to beneficiary shares and NFT assignments after the inheritance configuration is sealed.



* **Silence Limit:** The waiting period from the moment your wallet's outgoing transactions cease until the protocol officially recognizes your 'absence'. You can freely set this from a minimum of 1 month up to several years to fit your lifestyle. Security experts generally recommend setting a limit between 6 months and 1 year.



* **Settlement:** Once the Silence Limit is exceeded and the Capsule fires, settlement can begin immediately. Check in before the Silence Limit expires to reset the inactivity timer.
