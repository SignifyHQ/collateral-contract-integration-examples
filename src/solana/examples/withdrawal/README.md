# Withdrawal Examples

This folder contains withdrawal integration examples for different versions of the collateral contract.

- **withdrawalV1** — Example for version 1 of the contract.
- **withdrawalV2** — Example for version 2 of the contract.

## Content

1. [What version to use](#what-version-to-use)
2. [Migrating from V1 to V2](#migrating-from-v1-to-v2)

## 1. What version to use

Use the **version selector** script to determine which withdrawal example (V1 or V2) matches your collateral account. The script reads the account’s on-chain discriminator and tells you which version to use.

### How to run

From the project root:

```bash
yarn run solana:withdraw:select-version
```

### Script steps and prompts

1. **Solana network** — You are asked: *"Select the Solana network"* with two options:
   - **Mainnet** — uses the public Solana mainnet RPC
   - **Devnet** — uses the public Solana devnet RPC

2. **Collateral address** — You are asked: *"Enter the Collateral address:"*  
   Provide your collateral account’s public key (base58). The script validates that it is a valid Solana address.

3. **Version detection** — The script connects to the chosen RPC, fetches the collateral account data, and reads the first 8 bytes (the discriminator). It compares this discriminator to the known V1 and V2 values and determines your account version.

### Result

The script prints which withdrawal example to follow: **withdrawalV1** or **withdrawalV2**. Use the corresponding example in this folder (`withdrawalV1/` or `withdrawalV2/`) to perform your withdrawal.

## 2. Migrating from V1 to V2

If you already have a withdrawal implementation based on the V1 collateral contract and want to support the V2 contract, follow these steps. The overall flow (API calls, message encoding, signature submission, then withdraw instruction) stays the same; only the program interface and some account references change.

### 1. Switch IDL and types to V2

- **IDL**: Update the content of your IDL `main.json` by the content of the `src/solana/idl/mainV2.json` IDL.
- **Types**: Update the content of the Types file `main.ts` by the content of the `src/solana/types/mainV2.ts` file.

### 2. Fetch the collateral account with the V2 account type

Where you load the collateral account from the program, use the V2 account name:

- **From:** `await program.account.collateral.fetch(collateral)`
- **To:** `await program.account.collateralV2.fetch(collateral)`

The returned shape (e.g. `coordinator`, `adminFundsNonce`) is the same; the account discriminator and layout are defined by the V2 IDL.

### 3. Use the V2 collateral admin signatures account when checking/submitting

When you fetch the collateral admin signatures account (e.g. to see if the admin has already signed):

- **From:** `await program.account.collateralAdminSignatures.fetchNullable(collateralSignatureAddress)`
- **To:** `await program.account.collateralAdminSignaturesV2.fetchNullable(collateralSignatureAddress)`

The rest of your `submitSignatures` flow (instruction name and accounts like `collateral`, `collateralAdminSignatures`, `rentPayer`) can stay as in the V2 example.

### 4. Add the new accounts to the withdraw instruction

For the **withdrawCollateralAsset** instruction, the V2 program requires two extra accounts. Add them to the `.accounts(...)` object:

- **rentReceiver** — Set the account that will receive the lamports back when the signatures account is closed. It must to be the same account set as rent payer in the `submitSignatures` transaction.
- **tokenProgram** — Set to the SPL Token program: `TOKEN_PROGRAM_ID` (from `@solana/spl-token`).

So the accounts for `withdrawCollateralAsset` change from:

```ts
.accounts({
  sender: sender.publicKey,
  receiver: recipientAddress,
  asset: mintAddress,
  collateralTokenAccount: collateralTokenAccount,
  receiverTokenAccount: destinationTokenAccount.address,
  coordinator: collateralAccount.coordinator,
  collateral: collateral,
  collateralAdminSignatures: collateralSignatureAddress,
})
```

to:

```ts
.accounts({
  rentReceiver: sender.publicKey,
  sender: sender.publicKey,
  receiver: recipientAddress,
  asset: mintAddress,
  collateralTokenAccount: collateralTokenAccount,
  receiverTokenAccount: destinationTokenAccount.address,
  coordinator: collateralAccount.coordinator,
  collateral: collateral,
  collateralAdminSignatures: collateralSignatureAddress,
  tokenProgram: TOKEN_PROGRAM_ID,
})
```
