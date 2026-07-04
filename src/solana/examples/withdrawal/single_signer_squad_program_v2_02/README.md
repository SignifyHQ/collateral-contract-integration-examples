# Solana V2.02 CPI Signature Withdrawal Script (Squads Multisig)

## What This Script Does

This script demonstrates **automated token withdrawals** from Solana SingleSignerCollateral accounts owned by **Squads multisig PDAs** using V2 signatures from the Rain API. This is a more advanced withdrawal flow that uses Squads multisig governance for additional security and control.

### What is V2.02 CPI Signature Withdrawal?
A V2.02 CPI signature withdrawal is a **secure multi-party approval system** where:
- **Squads multisig PDA** owns the collateral account (not a single admin)
- **Coordinator signature** from Rain API provides authorization layer
- **Squads proposal workflow** requires multisig member approval
- **Cross-Program Invocation (CPI)** allows Squads to execute the withdrawal with PDA signature
- **Ed25519 signature verification** ensures coordinator authorization before execution

### Why Would You Use This Script?
- **Multisig governance**: Withdrawals require approval from multisig members
- **Enhanced security**: Multiple parties must approve withdrawals
- **Integration testing**: Test withdrawal flows with Squads multisig in development environment
- **Production deployments**: Use when collateral is managed by a multisig wallet

## How It Works

The script follows a **secure multi-step process**:

1. **API Request**: Gets withdrawal signature from Rain API with your parameters
2. **Multisig Setup**: Gets or creates a Squads v4 multisig (deterministic based on member key)
3. **Vault PDA Derivation**: Derives the vault PDA that owns the collateral
4. **Instruction Building**: Creates Ed25519 verification and withdrawal instructions separately
5. **Squads Workflow**: Creates vault transaction, proposal, and approval
6. **Transaction Execution**: Executes withdrawal with Ed25519 verification + Squads CPI

This ensures that **only authorized multisig members** can withdraw the correct amounts to the right destinations.

## Prerequisites

Before running this script, you need:

### 1. Environment Setup
Create an environment file based on your `NODE_ENV` in your project root with these variables:

**File naming pattern:** `.env.${NODE_ENV}`
- `.env.local` (default, for NODE_ENV=local)  
- `.env.example` (for NODE_ENV=example)

```bash
# Solana RPC endpoint (where to connect to the blockchain)
SOLANA_RPC_URL=https://api.devnet.solana.com

# Rain API authentication
RAIN_API_KEY=your_rain_api_key_here

# Squads multisig member's private key (Base58 encoded) - must be a member of the multisig
MEMBER_PK=your_multisig_member_private_key_here

# Transaction fee payer's private key (Base58 encoded)
PAYER_PK=your_fee_payer_private_key_here
```

### 2. Required Dependencies
Install the Squads SDK:
```bash
npm install @sqds/multisig
# or
yarn add @sqds/multisig
```

### 3. Required Information
You need to know these 6 pieces of information:

| Parameter | Description | How to Get It |
|-----------|-------------|---------------|
| `userId` | Your user ID in Rain system | From Rain dashboard or provided by admin |
| `token` | SPL token mint address you want to withdraw | Token mint address (e.g., USDC mint) |
| `amount` | Amount to withdraw (in token's smallest unit) | Calculate based on token decimals |
| `adminAddress` | Multisig member's public key (for API) | Same as the public key from MEMBER_PK |
| `recipientAddress` | Where to send withdrawn tokens | Your wallet's public key |
| `chainId` | Solana network identifier | "901" for devnet, "900" for mainnet |

## How to Run

### Step 1: Install Dependencies
```bash
yarn install
```

### Step 2: Set Up Environment
Create your environment file with the required variables (see Prerequisites above).
- Default: `.env.local` (if no NODE_ENV is set)
- Custom: `.env.${NODE_ENV}` (e.g., `.env.example` for NODE_ENV=example)

### Step 3: Run the Script
```bash
# Using default environment (.env.local)
yarn solana:squads-withdraw:v2-02 <userId> <token> <amount> <adminAddress> <recipientAddress> <chainId>

# Using specific environment file
NODE_ENV=example yarn solana:squads-withdraw:v2-02 <userId> <token> <amount> <adminAddress> <recipientAddress> <chainId>
```

### Example
```bash
# Default environment
yarn solana:squads-withdraw:v2-02 \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  100 \
  HFFdJHiEZBgniNh754BPqsCdeNasv3got5wJqRABHnCX \
  CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q \
  901

# With specific environment
NODE_ENV=example yarn solana:squads-withdraw:v2-02 \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  1000 \
  HFFdJHiEZBgniNh754BPqsCdeNasv3got5wJqRABHnCX \
  CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q \
  901
```

## Getting the Required Parameters

### Getting Collateral Information

**How to get your User ID**
- **Log in to the Rain Dashboard**.
- Go to the **Users** section.
- Find your user in the list — the **User ID** is displayed alongside your user name and status.

**How to get your API credentials:**
- **User ID**: Found in your Rain dashboard URL or provided by your admin
- **API Key**: Go to your Rain dashboard → **Config** section → **API Keys** → You can use an existing API Key or create a new one

### Getting Token Information

#### Token Mint Address
Common SPL tokens:
- **USDC**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet)
- **USDC**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (devnet)

#### Amount Calculation
The amount must be expressed in cents (e.g., 1.50 USDC = `150`).
- **Example**: To withdraw 1.5 USDC, use amount = `150`

### Getting Addresses

#### Admin & Recipient Addresses
- **Admin Address**: Extract public key from your `MEMBER_PK` (the multisig member's public key)
- **Recipient Address**: Your wallet's public key where you want to receive tokens

#### Chain ID
- **Devnet**: `901`
- **Mainnet**: `900`

## Squads multisig example

This example demonstrates how to use [Squads Multisig v4](https://docs.squads.so/main/development/typescript/overview) for secure, programmatic withdrawals from single-signer collateral contracts, leveraging a Squads smart wallet with a single member as the owner.

1. This section covers withdrawals for single signer collateral contracts. If you are not familiar with single signer collateral contract, please refer to [Single Signer collateral contract](#single-signer-collateral-contract) for guidance.

2. If you do not already have a [Squads Multisig v4](https://docs.squads.so/main/development/typescript/overview), you can create one programmatically as part of your setup. If you already have a multisig, you can skip this step and use your existing Vault PDA address as collateral owner.

```typescript
 /*
  * 1. Derive multisig PDA deterministically from member's public key (or use existing)
  * 2. Derive vault PDA from multisig PDA (index 0)
  */

  // Derive deterministic multisig PDA using member's public key as seed
  const createKey = Keypair.fromSeed(member.publicKey.toBuffer().slice(0, 32));
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });

  // Check if multisig already exists
  const accountInfo = await connection.getAccountInfo(multisigPda);
  
  if (accountInfo) {
    // Verify it's a Squads v4 multisig
    const SQUADS_V4_PROGRAM = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
    
    if (accountInfo.owner.equals(SQUADS_V4_PROGRAM) && accountInfo.data.length > 0) {
      console.log("✓ Multisig already exists");
      console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
      console.log(`  Data size: ${accountInfo.data.length} bytes\n`);
      return multisigPda;
    } else {
      throw new Error(
        `Account exists at ${multisigPda.toBase58()} but is not a valid Squads v4 multisig.\n` +
        `Owner: ${accountInfo.owner.toBase58()}\n` +
        `Expected: ${SQUADS_V4_PROGRAM.toBase58()}`
      );
    }
  }

  // Get program config for treasury
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda
  );
  const configTreasury = programConfig.treasury;

  // Create the multisig
  /**
   * Creating multisig with the following parameters:
   *   - Member: <member public key>
   *   - Threshold: 1 (single signature)
   *   - Permissions: All
   *
   * (The 'member' variable refers to the public key that will be the only
   * signer required for this multisig, providing full (all) permissions.)
   */
  const signature = await multisig.rpc.multisigCreateV2({
    connection,
    createKey,
    creator: payer,
    multisigPda,
    configAuthority: null,
    timeLock: 0,
    members: [
      {
        key: member.publicKey,
        permissions: multisig.types.Permissions.all(),
      },
    ],
    threshold: 1,
    rentCollector: null,
    treasury: configTreasury,
    sendOptions: { skipPreflight: true },
  });

  await connection.confirmTransaction(signature);
  
  console.log("✓ Multisig created successfully!");
  console.log(`  Multisig PDA: ${multisigPda.toBase58()}`);

  // Derive the vault PDA (this will be the collateral owner)
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0,
  });
```

3. Create the signature verification and the withdraw collateral asset instructions

```typescript
  // Resolve the token program from the mint — a mint account is owned by exactly its token
  // program, so this yields TOKEN_PROGRAM_ID for classic SPL mints and TOKEN_2022_PROGRAM_ID for
  // Token-2022 mints. Use the same value when deriving collateralTokenAccount /
  // destinationTokenAccount; hardcoding TOKEN_PROGRAM_ID silently derives wrong accounts for
  // Token-2022 mints.
  const mintInfo = await connection.getAccountInfo(mintAddress);
  const tokenProgramId = mintInfo!.owner;

  const withdrawalInstruction = await program.methods.withdrawSingleSignerCollateralAsset(withdrawRequest)                        
        .accounts({                                                                                
          owner: vaultPda,                                                                   
          coordinator,                                               
          collateral,                                                                   
          destination: recipientAddress,                                                            
          asset: mintAddress,                        
          collateralTokenAccount: collateralTokenAccount,                                           
          destinationTokenAccount,
          tokenProgram: tokenProgramId, // resolved from the mint owner (TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID), not hardcoded
        })

  const signatureVerificationInstruction = Ed25519ExtendedProgram.createSignatureVerificationInstruction([
        {
          signer: coordinator,
          signature: Buffer.from(coordinatorSignature),
          message: Coordinator.getWithdrawMessage(
            collateral,
            coordinator,
            vaultPda,
            recipientAddress,
            mintAddress,
            withdrawRequest,
            nonce
          )
        }
  ])
```

4. Get the next multisig transaction index

```typescript
  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection as any,
    multisigPdaKey
  );

  const currentTransactionIndex = Number(multisigInfo.transactionIndex);
  const newTransactionIndex = BigInt(currentTransactionIndex + 1);
```

5. Create vault transaction with ONLY the withdrawal instruction

```typescript
  const vaultMessage = new TransactionMessage({
    payerKey: vaultPda, // Vault PDA pays for the withdrawal
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [withdrawalInstruction], // ONLY withdrawal, Ed25519 will be top-level later
  });

  const vaultWithdrawalTransaction = await multisig.rpc.vaultTransactionCreate({
    connection: connection as any,
    feePayer: payer,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    creator: member.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: vaultMessage as any,
    memo: "Rain withdrawal (Ed25519 verified separately)",
  });

  await connection.confirmTransaction(vaultWithdrawalTransaction)
```

6. Create proposal

```typescript
  const proposalTransaction = await multisig.rpc.proposalCreate({
    connection: connection as any,
    feePayer: payer,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    creator: member,
    isDraft: false,
  });
  
  await connection.confirmTransaction(proposalTransaction);
```

7. Approve proposal

```typescript
  const approvalTransaction = await multisig.rpc.proposalApprove({
    connection: connection as any,
    feePayer: payer,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    member: member,
  });
  
  await connection.confirmTransaction(approvalTransaction);
```

8. Build the vaultTransactionExecute instruction using Squads SDK

```typescript
  const vaultTransactionExecuteResult = await multisig.instructions.vaultTransactionExecute({
    connection: connection as any,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    member: member.publicKey,
    programId: multisig.PROGRAM_ID,
  });
```

9. Build final transaction: Ed25519 THEN Squads execute

```typescript
  const finalTransaction = new Transaction();
  finalTransaction.add(ed25519Instruction); // Instruction 0: Ed25519 verification
  finalTransaction.add(vaultTransactionExecuteResult.instruction); // Instruction 1: Execute vault transaction
  
  const signature4 = await sendAndConfirmTransaction(
    connection,
    finalTransaction,
    [payer, member], // Payer and member sign
    { commitment: 'confirmed' }
  );
```

### What You'll See When Running

```
Member: [MemberPublicKey]
Payer: [PayerPublicKey]

=== GETTING OR CREATING SQUADS MULTISIG ===

Derived Multisig PDA: [MultisigPDA]
Create Key: [CreateKey]
✓ Multisig already exists

=== USING MULTISIG ===
Multisig PDA: [MultisigPDA]

Contract found: [CollateralProxyAddress]
Program: [ProgramAddress]
Deposit: [DepositAddress]

=== DERIVED VAULT PDA ===
Multisig PDA: [MultisigPDA]
Vault PDA (index 0): [VaultPDA]
(The collateral owner should be the vault PDA, not the multisig PDA)

Building withdrawal instructions...
Collateral owner: [VaultPDA]
Vault PDA (expected owner): [VaultPDA]
Collateral nonce: [Nonce]
Source token account [TokenAccountAddress]
Destination token account [YourTokenAccountAddress]
Coordinator executor: [ExecutorAddress]

=== SQUADS MULTISIG WORKFLOW (Ed25519 + Vault Execution) ===

Step 1: Creating vault transaction (withdrawal only, no Ed25519)...
✓ Vault transaction created (withdrawal instruction stored)
  Transaction: [TransactionSignature]

Step 2: Creating proposal...
✓ Proposal created
  Transaction: [TransactionSignature]

Step 3: Approving proposal (threshold = 1)...
✓ Proposal approved
  Transaction: [TransactionSignature]

Step 4: Building final transaction with Ed25519 + vaultTransactionExecute...
✓ Transaction executed successfully!
  Transaction: [TransactionSignature]

=== WITHDRAWAL COMPLETED ===
Transaction executed via Squads multisig CPI
Recipient: [RecipientAddress]
Amount: [Amount]
```

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|--------|----------|
| "RAIN_API_KEY environment variable is required" | Missing API key | Add `RAIN_API_KEY` to your environment file |
| "MEMBER_PK environment variable required" | Missing member private key | Add `MEMBER_PK` to your environment file |
| "PAYER_PK environment variable required" | Missing payer private key | Add `PAYER_PK` to your environment file |
| "Signature is pending" | Rain API hasn't approved yet | Wait a moment and retry |
| "Error: Signature is pending" | Signature generation is still processing | Wait a few seconds and retry the request |
| "Contract not found" | Invalid user/collateral combination | Verify userId and that you have collateral contracts |
| "Owner mismatch. Expected vault PDA: X, Got: Y" | Collateral owner is not the expected vault PDA | Verify the collateral is owned by the Squads vault PDA, not the multisig PDA |
| "No executors found in the given coordinator" | Coordinator account is invalid | Verify the coordinator account has executors configured |
| "Collateral balance of USDC in contract X is lower than requested amount" | Collateral contract does not have enough tokens | Fund the deposit address (provided in the API response) with sufficient tokens, then retry |
| "Invalid signature response" | API error or invalid parameters | Verify all parameters match expected format |

#### Getting Collateral Information

You can get your collateral address and program ID using the Rain API:

```bash
curl --location 'https://api-dev.raincards.xyz/v1/issuing/users/YOUR_USER_ID/contracts' \
--header 'Api-Key: YOUR_API_KEY' \
--header 'accept: application/json'
```

**Response Example:**
```json
[
    {
        "id": "e5e2b857-1519-4036-b372-ab3604524db5",
        "chainId": 901,
        "programAddress": "Ebc9nwbsByBsSKmz9br6UKzhybhzumPDS3nDTvWEZsAk",
        "controllerAddress": "HFFdJHiEZBgniNh754BPqsCdeNasv3got5wJqRABHnCX",
        "proxyAddress": "5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7",
        "depositAddress": "HuXG6s98A77syVPKtYWAKyG7jTHJCunBBFhKU6ZB2qZt",
        "tokens": [...],
        "contractVersion": 2
    }
]
```

**Extract the parameters:**
- **Collateral Address** = `proxyAddress` field (e.g., `5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7`)
- **Program ID** = `programAddress` field (e.g., `Ebc9nwbsByBsSKmz9br6UKzhybhzumPDS3nDTvWEZsAk`)

### Getting Help
- Ensure your member private key is part of the multisig that owns the collateral
- Verify the collateral account owner is the Squads vault PDA (not the multisig PDA)
- Check that the token mint address is correct for your network (devnet vs mainnet)
- Verify the amount is in the token's smallest unit (considering decimals)
- Make sure recipient address can receive SPL tokens
- Ensure the multisig has sufficient threshold approvals (default script uses threshold = 1)

## Related Documentation

- [CODING_GUIDELINES.md](../../../../CODING_GUIDELINES.md) — `@rain/program` imports and program version comparison
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Solana CLI Documentation](https://docs.solana.com/cli)
- [SPL Token Documentation](https://spl.solana.com/token)
- [Squads Multisig SDK Documentation](https://docs.squads.so/)

