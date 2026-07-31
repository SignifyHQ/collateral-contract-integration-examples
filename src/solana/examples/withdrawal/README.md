# Withdrawal Examples

This folder contains withdrawal integration examples for different versions of the collateral contract program.

- **multisig_program_v2_00** — Multisig withdrawal (program v2.00)
- **multisig_program_v2_01** — Multisig withdrawal (program v2.01)
- **single_signer_program_v2_02** — Single-signer withdrawal (program v2.02)
- **single_signer_squad_program_v2_02** — Squads single signer withdrawal (program v2.02)
- **multisig_timelock_program_v2_05** — Multisig timelock (permissionless) withdrawal (program v2.05)
- **single_signer_timelock_program_v2_05** — Single-signer timelock (permissionless) withdrawal (program v2.05)

For program version comparison and `@rain/program` import usage, see [CODING_GUIDELINES.md](../../../CODING_GUIDELINES.md).

## Content

1. [What version to use](#what-version-to-use)
2. [Migrating from v2.00 to v2.01](#2-migrating-from-v201-to-v202)
3. [Timelock (permissionless) withdrawals — program v2.05](#3-timelock-permissionless-withdrawals--program-v205)

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

The script prints which withdrawal example to follow. Use the corresponding example in this folder (`multisig_program_v2_00/`, `multisig_program_v2_01/`, `single_signer_program_v2_02/`, or `single_signer_squad_program_v2_02/`) to perform your withdrawal. For program v2.05 collaterals, the timelock alternatives are `multisig_timelock_program_v2_05/` and `single_signer_timelock_program_v2_05/`.

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

## 3. Timelock (permissionless) withdrawals — program v2.05

Program v2.05 adds **timelock withdrawals** (on-chain the feature is called *permissionless withdrawal*: no Rain co-signature is needed at execution time). Instead of requesting a withdrawal signature from the Rain API, the collateral admins (or the single-signer owner) create a withdrawal request directly on-chain. The request commits the amount, asset and recipient, and starts a **7-day timelock**:

- **Rain reviews the request** and usually executes it early (*expedited*), so funds arrive without waiting for the timelock. Rain can instead cancel the request with a reason (e.g. the amount exceeds the team's spending power).
- **If Rain does not act**, any current collateral admin (or the owner) can execute the request themselves once the timelock elapses — this is the guaranteed exit path.
- **The requesting side can cancel** a pending request at any time, without a reason, reclaiming the request account's rent.

![Timelock withdrawal lifecycle](../../../../out/src/solana/examples/withdrawal/diagrams/timelock_withdrawal_lifecycle/Timelock%20withdrawal%20lifecycle.png "Timelock withdrawal lifecycle")

Rules that apply to every timelock withdrawal:

- **One live request per collateral + asset pair.** The request account address is derived from the collateral and the asset mint, so a second request for the same pair fails until the pending one is executed or cancelled.
- **No on-chain status field.** A request is pending while its account exists and terminal once the account is closed; the outcome (executed/cancelled) is carried by events and exposed off-chain via the API (see [Tracking requests](#tracking-requests)). The timelock events are emitted via CPI — they appear as inner instructions, not program logs (see the *Consuming timelock events* section of the withdraw-collateral docs).
- **The feature is opt-in per coordinator** and disabled by default: requests fail with `TimelockNotEnabled` until Rain creates the coordinator's `TimelockConfig` with `enabled = true`. Disabling it later only blocks *new* requests — pending ones can still be executed or cancelled.
- **The delay is fixed at 7 days** by the program; it is not configurable per coordinator.
- **Requests do not expire.** Once `executable_from` passes, a request stays executable indefinitely until it is executed or cancelled.
- **Amounts are in the asset's base units** (1 SOL = `1000000000`, 1 USDC = `1000000`), unlike the cent-denominated signature flow.

### Multisig flow

See [multisig_timelock_program_v2_05](multisig_timelock_program_v2_05/). Requesting is a 2-transaction flow:

1. `submit_signatures` with the `RequestPermissionlessWithdrawal` submission type stores the admins' Ed25519 signatures on-chain (re-run per admin until the threshold is reached).
2. `request_permissionless_withdrawal` consumes the signatures account and creates the request. The transaction sender must itself be an admin, and its rent payer must be the admin that paid the signatures account rent.

A pending multisig request is bound to the collateral's governance state: adding/removing admins, changing the threshold or transferring the team makes it stale (`ApprovalConfigChanged`) — cancel it to reclaim the rent and request again.

### Single-signer flow

See [single_signer_timelock_program_v2_05](single_signer_timelock_program_v2_05/). Requesting is a single `request_single_signer_permissionless_withdrawal` transaction signed by the owner — no admin signatures and no nonce. If the collateral ownership is transferred while a request is pending, the request becomes stale (`RequesterNoLongerOwner`) and can only be cancelled.

### Manual cancellation

Both example scripts expose a `cancel` action calling `cancel_permissionless_withdrawal`. Admins/owners must cancel **without** a reason; cancellation reasons are reserved for Rain executors and surface in the API's `cancellationReason` field.

![Timelock withdrawal cancellation](../../../../out/src/solana/examples/withdrawal/diagrams/timelock_withdrawal_cancel/Timelock%20withdrawal%20cancellation.png "Timelock withdrawal cancellation")

### Coexistence with signature-based withdrawals

Timelock withdrawals **do not replace** the signature-based flow — v2.05 keeps `withdraw_collateral_asset` and `withdraw_single_signer_collateral_asset` unchanged, and both flows operate on the same collateral accounts:

- The signature-based flow remains the immediate path: request a signature from the Rain API and execute in one transaction (see the v2.00–v2.02 examples in this folder).
- The timelock flow removes the signature dependency at the cost of the review window; it is the recommended path for integrations that need a Rain-independent exit.
- A pending timelock request does not block signature-based withdrawals, and vice versa. Note that a multisig timelock request consumes the same `adminFundsNonce` as signature withdrawals, so admin signatures collected for one flow cannot be replayed by the other.

### Tracking requests

Both example scripts expose a `list` action calling the tenant API:

```
GET /v1/issuing/time-lock-withdrawals
```

Query parameters: `cursor`, `limit` (1–100, default 20), `chainId` (`"900"` mainnet, `"901"` devnet), `assetAddress`, `status` (`PENDING` | `EXECUTED` | `CANCELLED`), `unlockAfter`, `unlockBefore`. Each entry reports the request identity, amount, recipient, `isUnlocked`/`unlockedAt`, and — once terminal — the execution or cancellation transaction hashes and the `cancellationReason` for Rain-side cancellations.
