# Withdrawal Examples

This folder contains withdrawal integration examples for different versions of the collateral contract program.

- **multisig_program_v2_00** — Multisig withdrawal (program v2.00)
- **multisig_program_v2_01** — Multisig withdrawal (program v2.01)
- **multisig_program_v2_01_tenant** — Multisig withdrawal (program v2.01) for self-managed tenants (tenant API endpoints, no `userId`)
- **single_signer_program_v2_02** — Single-signer withdrawal (program v2.02)
- **single_signer_program_v2_02_tenant** — Single-signer withdrawal (program v2.02) for self-managed tenants (tenant API endpoints, no `userId`)
- **single_signer_squad_program_v2_02** — Squads single signer withdrawal (program v2.02)

For program version comparison and `@rain/program` import usage, see [CODING_GUIDELINES.md](../../../CODING_GUIDELINES.md).

## Content

1. [What version to use](#what-version-to-use)
2. [Migrating from v2.00 to v2.01](#2-migrating-from-v201-to-v202)

## 1. What version to use

Use the **version selector** script to determine which withdrawal example matches your collateral account (for program v2.00, v2.01, v2.02 choose the matching folder). The script reads the account’s on-chain discriminator and tells you which version to use.

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

The script prints which withdrawal example to follow. Use the corresponding example in this folder (`multisig_program_v2_00/`, `multisig_program_v2_01/`, `single_signer_program_v2_02/`, or `single_signer_squad_program_v2_02/`) to perform your withdrawal.

## 2. Migrating from v2.01 to v2.02

If you already have a withdrawal implementation based on the v2.01 collateral program and want to support the v2.02 program, follow these steps. The overall flow (API calls, message encoding, signature submission, then withdraw instruction) stays the same; only the program interface and some account references change.

### 1. Switch IDL and program to the target version

- Use the `@rain/program` path alias (see [CODING_GUIDELINES.md](../../../CODING_GUIDELINES.md)).
- Import the matching version: `IdlV2_XX` and `MainV2_XX` from `@rain/program` or `@rain/v2_XX`.
- The IDL and types live in `src/solana/program/v2_XX/` (e.g. `main.json`, `main.ts`).

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
- **tokenProgram** — Set to the token program that **owns the mint**, not a hardcoded value. For a classic SPL mint this is `TOKEN_PROGRAM_ID`; for a Token-2022 mint it must be `TOKEN_2022_PROGRAM_ID` (both from `@solana/spl-token`). Hardcoding `TOKEN_PROGRAM_ID` silently derives the wrong associated token accounts for Token-2022 mints. Resolve it from the mint — its account `owner` *is* its token program — and use the same value when deriving `collateralTokenAccount` / `receiverTokenAccount`:

  ```ts
  // The mint account is owned by exactly its token program.
  const mintInfo = await connection.getAccountInfo(mintAddress);
  const tokenProgram = mintInfo!.owner; // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
  ```


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
  tokenProgram, // resolved from the mint owner (see note above), not hardcoded
})
```
