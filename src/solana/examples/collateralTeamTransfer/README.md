# Solana Collateral Admin Transfer Script

The general flow of the Collateral transfer_team flow is described as follows:

![alt text](../../../../out/src/solana/examples/collateralTeamTransfer/diagrams/sequence/Transfer%20collateral%20team%20sequence.png "Title")

Where:
* **Admin:** Is the admin of the Collateral account that wants to transfer it to either a new admin or group of admins.
* **Admin Signer:** is the Solana account set as admin into the Collateral account that you must have access to sign both transactions and Buffers of information. It can be a custodial wallet like Phantom Wallet, a non-custodial like Privy, a smart account or a multi-sign account.
* **Message Generator:** Is a utility included in this example at the file `messageGenerator.ts` that helps to generate the message that must be signed by your **Admin Signer** to authorize the transference of your **Collateral**.
* **Solana RPC:** A Solana node connected to the network on either Mainnet, Devnet or Localnet.
* **Collateral:** Is the Collateral account stored in the Solana network that you want to transfer.
* **Collateral Admin Signatures:** Is a support account that will helps to temporary store the autorization given by you **Admin Signer** to transfer the **Collateral** account.

This flow is implemented under the example at the file `index.ts` using a Keypair of the **Admin Signer** to sign the authorization message and send the transaction to the chain. If you want to go deep into the example jump to the [What This Script Does](#-what-this-script-does) section. Otherwise, continue reading the [How to Create Your Own Integration](#-how-to-create-your-own-integration) section.

## 🔧 How to Create Your Own Integration

This section provides a step-by-step guide for creating your own integration to transfer collateral team ownership. It is assumed that you have your own way to load the signer in your environment.

### Step 1: Generate the Request

First, import the types and create a `TransferCollateralTeamRequest` with the new information for the collateral account:

```typescript
import { TransferCollateralTeamRequest } from "./types";
import { PublicKey } from "@solana/web3.js";

// Create the transfer request
const transferRequest: TransferCollateralTeamRequest = {
  newName: "New Team Name", // The new name for the collateral account
  newAdmins: [
    new PublicKey("NewAdmin1PublicKeyHere"),
    new PublicKey("NewAdmin2PublicKeyHere")
  ], // Array of new admin public keys
  newAdminThreshold: 2 // Number of admins required to approve future operations
};
```

### Step 2: Generate and Sign the Message

Import the message generator and create a `TransferCollateralTeamMessage` to generate the message that needs to be signed:

```typescript
import { TransferCollateralTeamMessage } from "./messageGenerator";

// Get the current admin data nonce from the collateral account
const currentNonce = collateralAccount.adminDataNonce;

// Create the message to sign
const transferMessage = new TransferCollateralTeamMessage(transferRequest, currentNonce);

// Generate the message buffer that needs to be signed
const messageBuffer = Buffer.from(transferMessage.encode(), "hex");

// Sign the message with your admin signer
// Note: This is where you would use your own signer implementation
const signature = await signer.signMessage(messageBuffer);
```

### Step 3: Upload the Signatures

Create a transaction with two instructions to upload the signatures:

#### 3.1: Ed25519 Instruction

For collateral accounts with a single admin, use the standard `Ed25519Program`:

```typescript
import { Ed25519Program } from "@solana/web3.js";

// Create Ed25519 instruction for single admin
const ed25519Instruction = Ed25519Program.createInstruction({
  publicKey: signer.publicKey.toBytes(),
  message: messageBuffer,
  signature: signature
});
```

For collateral accounts with multiple admins, use the extended program:

```typescript
import { Ed25519ExtendedProgram } from "../utils/ed25519.program";

// Create Ed25519 instruction for multiple admins
const signatureData = {
  signer: signer.publicKey,
  signature: signature,
  message: messageBuffer
};

const ed25519Instruction = Ed25519ExtendedProgram.createSignatureVerificationInstruction([signatureData]);
```

#### 3.2: Submit Signatures Instruction

Create the submit signatures instruction using the Rain program:

```typescript
import { Program } from "@coral-xyz/anchor";
import { Main } from "../types/main";

// Create the signature submission request
const signatureRequest = {
  targetNonce: currentNonce,
  signatureSubmissionType: {
    transferCollateralTeam: {
      "0": transferRequest
    }
  },
  salts: [Array.from(crypto.randomBytes(32))] // Random salt for each signature
};

// Create the submit signatures instruction
const submitSignaturesIx = await program.methods
  .submitSignatures(signatureRequest as any)
  .accounts({
    rentPayer: feePayer.publicKey,
    collateral: collateralAddress,
    collateralAdminSignatures: signaturesAccountAddress,
  })
  .instruction();

// Send the transaction with both instructions
const transaction = new Transaction()
  .add(ed25519Instruction)
  .add(submitSignaturesIx);

const txSignature = await sendAndConfirmTransaction(connection, transaction, [feePayer]);
console.log("Signatures uploaded:", txSignature);
```

### Step 4: Send the Transfer Team Transaction

Finally, invoke the `transfer_collateral_team` transaction using the Anchor program:

```typescript
// Generate the PDA for the signatures account
const signaturesAccountAddress = CollateralAdminSignatures.generateTransferCollateralTeamPDA(
  collateral,
  transferRequest,
  program.programId
);

// Create and send the transfer transaction
const transferTx = await program.methods
  .transferCollateralTeam(transferRequest)
  .accounts({
    sender: feePayer.publicKey,
    collateral: collateralAddress,
    collateralAdminSignatures: signaturesAccountAddress,
  })
  .signers([feePayer])
  .rpc();

console.log("Transfer completed:", transferTx);
```

### Important Notes

- **Signer Implementation**: You must implement your own way to load and use the signer in your environment
- **Transaction Size Limits**: Solana has a 1232-byte transaction size limit, so keep the number of admins reasonable (recommended max: 5)
- **Nonce Management**: Always use the current `adminDataNonce` from the collateral account to prevent replay attacks
- **Error Handling**: Implement proper error handling for network issues, insufficient funds, and invalid signatures
- **Testing**: Always test on devnet before deploying to mainnet

# Ready to use example

## 🎯 What This Script Does

This script **transfers administrative control** of a Solana collateral account from the current admin to a new admin. Think of it like changing the ownership of a digital safe - you need the current key holder to authorize the transfer to the new key holder.

### What is a Collateral Account?

A collateral account is a **digital vault** on the Solana blockchain that:

- Holds assets (SOL and SPL tokens)
- Has **admin controls** — only authorized admins can manage it
- Requires admin signatures to make changes

### Why Would You Use This Script?

- **Changing ownership**: Transfer control from one admin address to another
- **Security rotation**: Regularly change admin account for better security
- **Recovery**: If an admin key is compromised, transfer to a new secure key

## 🔧 How It Works

The script runs a **secure two-step flow**:

1. Create signature(s): The current admin produces cryptographic proof authorizing the transfer.
2. Execute transfer: A transaction verifies those signatures and moves admin control to the new admin.

This ensures that **only the current, legitimate admin** can transfer control.

## 🔄 Transfer Flow Overview

The collateral team transfer process follows a secure multi-step flow designed to ensure only authorized admins can transfer control while working within Solana's transaction size limitations. Here's how the script works:

### Step 1: Load Private Keys (Lines 515-519)
The script loads the private keys of the current collateral admin and the fee payer account from environment variables. While this example uses Solana private keys, **any mechanism capable of signing Solana transactions and string messages can be used**, including Privy, hardware wallets, or other wallet providers.

```typescript
/**
 * Safely decodes a Base58-encoded private key from environment variables
 *
 * @param secretKeyValue - Base58-encoded private key string
 * @returns Solana Keypair for transaction signing
 * @throws Error if key is missing or invalid
 */
function getSecretKey(secretKeyValue: Base58SecretKey | undefined): Keypair {
  if (!secretKeyValue) {
    throw new Error("No secret key provided");
  }

  const secret: any = bs58.decode(secretKeyValue);
  return Keypair.fromSecretKey(secret);
}

// ---------------------------------------------------------------------

const currentAdmin = getSecretKey(process.env.CURRENT_ADMIN_PK);
const feePayer = getSecretKey(process.env.FEE_PAYER_PK);
console.log(`Current admin: ${currentAdmin.publicKey.toBase58()}`);
console.log(`Fee payer: ${feePayer.publicKey.toBase58()}`);
```

### Step 2: Fetch Current Collateral State (Lines 521-533)
The script retrieves the current information of the collateral account to be transferred. This step is **mandatory** because it must know the current nonce to generate the authorization for the team transfer. The nonce is a numerical value that identifies each individual operation against the collateral account (add_admin, remove_admin, transfer_team) and helps prevent replay attacks by ensuring each action can only be executed once.

```typescript
/**
 * Establishes connection to the Solana collateral management program
 *
 * This function creates an Anchor Program instance that provides a typed interface
 * for interacting with the on-chain collateral management smart contract.
 *
 * @param programAddress - The Solana program ID (smart contract address)
 * @param signer - Keypair used for signing transactions (fee payer)
 * @returns Configured Program instance for blockchain interactions
 * @throws Error if SOLANA_RPC_URL environment variable is not set
 */
function getProgram(programAddress: string, signer: Keypair): Program<Main> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL environment variable is required");
  }

  // Load the program's IDL (Interface Definition Language) - this is like an ABI
  // that defines the smart contract's methods and data structures
  const idl: any = Object.assign(MainIdl, { address: programAddress });

  // Create provider with confirmed commitment level for reliability
  const opts = AnchorProvider.defaultOptions();
  const provider = new AnchorProvider(new Connection(rpcUrl, { commitment: "confirmed" }), new Wallet(signer), opts);

  // Return typed interface to the smart contract
  return new Program<Main>(idl, provider);
}

// ---------------------------------------------------------------------

// Connect to the Solana program (smart contract)
const program: Program<Main> = getProgram(programId, feePayer);

// Fetch current state of the collateral account from blockchain
console.log("📖 Loading collateral account from blockchain...");
const collateralPublicKey = new PublicKey(collateralAddress);
const collateralAccount = await program.account.collateral.fetch(collateralPublicKey);
const collateral: Collateral = new Collateral(collateralPublicKey, collateralAccount);
```

### Step 3: Generate Transfer Request (Lines 535-541)
The script creates the transfer request containing:
- **New name**: A string identifier for the collateral account (doesn't affect logic, just for naming)
- **New admins list**: Array of public keys for the new administrative team
- **New admin threshold**: Number of admins required to approve future operations

**Important restrictions:**
- The name cannot be empty
- The admin threshold cannot exceed the length of the new admins list
- Solana has a transaction size limit of 1232 bytes, so we recommend to transfer to a maximum of 5 admins to avoid breaking the transaction.

```typescript
const transferCollateralTeam = {
  newName: collateralAccount.name, // Keep existing name
  newAdmins: [new PublicKey(newAdminAddress)], // Replace with new admin
  newAdminThreshold: collateralAccount.adminThreshold, // Keep existing threshold
};
console.log(`New admin will be: ${newAdminAddress}`);
```

### Step 4: Generate and Submit Admin Signatures (Lines 543-553)
The current admins create cryptographic signatures authorizing the transfer. This is a **two-instruction transaction**:
1. **Ed25519 Solana instruction**: Verifies the cryptographic signatures
2. **SubmitSignatures instruction**: Stores the verified signatures in a PDA (Program Derived Address).

```typescript
/**
 * Sends the transaction to verify and upsert multiple collateral admin signatures
 * @param collateral - The collateral account
 * @param salts - The salts that were used to generate the signatures
 * @param rentPayer - The add account rent payer
 * @param ed25519Instruction - The ed25519 instruction with the signatures to verify and submit
 * @returns The transaction signature.
 */
async function upsertCollateralAdminSignatures(
  id: Buffer,
  collateral: PublicKey,
  program: Program<Main>,
  request: SignaturesSubmissionRequest,
  rentPayer: Keypair,
  ed25519Instruction: TransactionInstruction
): Promise<string> {
  // Get the signatures account address
  const signaturesAccountAddress = CollateralAdminSignatures.generatePDA(collateral, id, program.programId);

  // Send the transaction
  return await program.methods
    .submitSignatures(request as any)
    .accounts({
      rentPayer: rentPayer.publicKey,
      collateral: collateral,
      collateralAdminSignatures: signaturesAccountAddress,
    })
    .preInstructions([ed25519Instruction])
    .signers([rentPayer]) // rent payer = fee payer
    .rpc();
}
```

Notice the admins are not required to sign the transaction itself but a encoded payload of the transaction that includes the arguments of the operation defined in step 3.

```typescript
/**
 * Creates the transfer collateral team signature verification instruction
 * @param collateral - The collateral account
 * @param request - The transfer collateral team instruction data
 * @param salts - The salts to use for the signatures
 * @param admins - The admins KeyPairs
 * @returns The transfer collateral team signature verification instruction
 */
function createTransferCollateralTeamSignatures(
  collateral: Collateral,
  request: TransferCollateralTeamRequest,
  salts: number[][],
  admins: Keypair[]
): TransactionInstruction {
  // Create the signatures array
  const signatures: SignatureVerificationData[] = [];
  // Create the signatures
  for (let i = 0; i < admins.length; i++) {
    // Get the message
    const message: any = collateral.getTransferCollateralTeamMessage(request, salts[i]);
    // Create the signature
    const signature = nacl.sign.detached(message, admins[i].secretKey);
    // Create the signature data
    const signatureData: SignatureVerificationData = {
      signer: admins[i].publicKey,
      signature: Buffer.from(signature),
      message,
    };
    // Push the signature
    signatures.push(signatureData);
  }
  // Return the signature verification instruction
  return Ed25519ExtendedProgram.createSignatureVerificationInstruction(signatures);
}

/**
 * Helper to send the transaction to upsert the TransferCollateralTeam signatures into the PDA
 * @param collateral - The collateral account to upsert the signatures into
 * @param request - The transfer collateral team instruction data
 * @param currentAdmins - The current admins that will sign the request
 * @param rentPayer - The account rent payer
 * @returns The transaction signature
 */
async function upsertTransferCollateralTeamSignatures(
  collateral: Collateral,
  program: Program<Main>,
  request: TransferCollateralTeamRequest,
  currentAdmins: Keypair[],
  rentPayer: Keypair = currentAdmins[0]
): Promise<string> {
  // Check that at least one signer is provided
  if (currentAdmins.length === 0) {
    throw new Error("At least one signer must be provided");
  }
  // Create the action message hash
  const actionMessageEncoded = new TransferCollateralTeamMessage(request, collateral.adminDataNonce).encode();
  // Create the id
  const id = Buffer.from(actionMessageEncoded, "hex");
  // Create the salts
  const salts = currentAdmins.map((_) => Array.from(randomBytes(32)));
  // Create the signature instruction
  const signatureInstruction = createTransferCollateralTeamSignatures(collateral, request, salts, currentAdmins);
  // Send the transaction
  return await upsertCollateralAdminSignatures(
    id,
    collateral.address,
    program,
    {
      targetNonce: collateral.adminDataNonce,
      salts,
      signatureSubmissionType: {
        transferCollateralTeam: {
          "0": request,
        },
      },
    },
    rentPayer,
    signatureInstruction
  );
}
```

This step requires the capability to sign with the current admins of the collateral contract as mentioned in the step 1.

```typescript
console.log("📝 Creating and submitting admin signatures...");
const signatureTx = await upsertTransferCollateralTeamSignatures(
  collateral,
  program,
  transferCollateralTeam,
  [currentAdmin], // Current admin signs the transfer
  feePayer // Fee payer covers transaction costs
);
console.log(`Signature transaction: ${signatureTx}`);
await waitForTransaction([signatureTx], program.provider.connection);
```

**Note:**  The signature example uses the nacl package to sign the message at line 593 while the submit_signatures transaction is sent at line 390.

### Step 5: Execute Transfer Transaction
Once signatures are submitted and verified, the transfer can be executed. The script invokes the transfer transaction with the same arguments from Step 3 and the signatures from Step 4. Since the transaction is pre-authorized with specific arguments, any current admin can send the transaction.

```typescript
console.log("🔄 Executing admin transfer...");
const transferCollateralTeamSignaturesPDA = CollateralAdminSignatures.generateTransferCollateralTeamPDA(
  collateral,
  transferCollateralTeam,
  program.programId
);

const tx = await program.methods
  .transferCollateralTeam(transferCollateralTeam)
  .accounts({
    sender: feePayer.publicKey,
    collateral: collateralAddress,
    collateralAdminSignatures: transferCollateralTeamSignaturesPDA,
  })
  .signers([feePayer])
  .rpc();

console.log(`Transfer transaction: ${tx}`);
```

**Note:** After the signatures are consumed and the operation completes, the rent for creating the signatures storage account is returned to the admin who called the transferTeam function under the `sender` roles specified in the accounts definition of the transaction using the provided IDL.

## 🏗️ Design Considerations

### Why This Two-Step Flow?

**Authorization Mechanism**: The authorization is provided by admins signing a message that includes the operation arguments (new name, list of admins, and threshold value). This signature is submitted to the chain for verification and stored in an account that holds the authorization until consumed during transfer execution. Verification occurs by:
1. Checking that the signature generated using the Ed25519 curve belongs to a current admin of the collateral
2. Verifying that the signed message matches the expected one corresponding to the transfer invocation arguments

**Two-Step Signature Submission**: Signatures are submitted in two steps due to Solana's transaction size limitation of 1232 bytes. Each signature takes 160 bytes of transaction space for verification, which for some operations allows only 2 signatures per transaction. By submitting signatures to a storage account first, we unlock the admin limit by sending signatures in batches of 4-5 per transaction, then executing the transfer with the pre-verified signatures.

## 📋 Prerequisites

Before you start, make sure you have:

### 1. Environment Setup

In the project root, create an environment file that matches your `NODE_ENV` and include these variables:

**File naming pattern:** `.env.${NODE_ENV}`

- `.env.local` (default, for NODE_ENV=local)
- `.env.example` (for NODE_ENV=example)

```bash
# Solana RPC endpoint (where to connect to the blockchain)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
# You can also use devnet for testing: https://api.devnet.solana.com

# Current admin's private key (Base58 encoded)
CURRENT_ADMIN_PK=your_current_admin_private_key_here

# Fee payer's private key (Base58 encoded) - pays for blockchain transactions
FEE_PAYER_PK=your_fee_payer_private_key_here
```

### 2. Required Information

You'll need three values:

| Parameter           | Description                                                | How to Get It                                                                             |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `collateralAddress` | The address of the collateral account you want to transfer | [Collateral contract info API](https://docs.rain.xyz/reference/getissuingusercontracts#/) |
| `programId`         | The Solana program that manages this collateral            | [Collateral contract info API](https://docs.rain.xyz/reference/getissuingusercontracts#/) |
| `newAdminAddress`   | The public key of the new admin                            | Generate a new Solana wallet or get the public key from the intended new admin            |

## 🚀 How to Run

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
yarn solana:collateral-transfer <collateralAddress> <programId> <newAdminAddress>

# Using specific environment file (.env.example, .env.development, etc.)
NODE_ENV=example yarn solana:collateral-transfer <collateralAddress> <programId> <newAdminAddress>
```

### Example

```bash
# Default environment
yarn solana:collateral-transfer \
  5ZWj7a1f122312QsYGqAoECZYHBPzJHRLZMXab \
  Ebc9nwbsByBsSKmz9br6UKzhybhzumPDS3nDTvWEZsAk \
  3WdDdKJaZmn2QDTWR8xVzjdHLZQmqzjdwMNXyz

# With specific environment
NODE_ENV=example yarn solana:collateral-transfer \
  5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7 \
  Ebc9nwbsByBsSKmz9br6UKzhybhzumPDS3nDTvWEZsAk \
  CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q
```

## 📖 Getting the Required Parameters

### Getting Your Private Keys

#### Current Admin Private Key

- **Phantom Wallet**: Follow the official guide: [How to export private keys from Phantom](https://help.phantom.com/hc/en-us/articles/28355165637011-How-to-export-private-keys-from-Phantom#h_01K2HJNXZ7VMNSTWSHBMAQB77D)

#### Fee Payer Private Key

- Can be the same as current admin
- Should have enough SOL to pay for transactions (~0.01 SOL is usually enough)
- Will temporarily pay rent for the signatures account (this rent is returned after the signatures are consumed)

#### New Admin Public Key

- If creating new wallet: Generate with `solana-keygen new` and use the public key
- If transferring to existing person: They provide their wallet's public key

### Getting Collateral Information

#### Method 1: Rain API (Recommended)

You can get your collateral address and program ID using the [Rain API](https://docs.rain.xyz/reference/getissuingusercontracts#/):

```bash
curl --location 'https://api-dev.raincards.xyz/v1/issuing/users/YOUR_USER_ID/contracts' \
--header 'Api-Key: YOUR_API_KEY' \
--header 'accept: application/json' \
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

**How to get your User ID**

- **Log in to the Rain Dashboard**.
- Go to the **Users** section.
- Find your user in the list — the **User ID** is displayed alongside your user name and status.

**How to get your API credentials:**

- **User ID**: Found in your Rain dashboard URL or provided by your admin
- **API Key**: Go to your Rain dashboard → **Config** section → **API Keys** → You can use an existing API Key or create a new one

#### Method 2: Solana Explorer Lookup

If you know your collateral address, you can look up the program ID using the Explorer:

1. Go to [Solana Explorer](https://explorer.solana.com/)
2. Switch to the correct network (Mainnet Beta or Devnet)
3. Search for your collateral address
4. Find the "Assigned Program ID" — this is your `programId`

**Example:**

- Collateral Address: `5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7`
- Explorer URL: [explorer page](https://explorer.solana.com/address/5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7?cluster=devnet)
- Look for "Assigned Program ID" to get your `programId`

## 📱 What You'll See When Running

```
🚀 Starting collateral admin transfer process...
Current admin: 7xKXtg2CW87d97TX5jBkheTqA83TZRuJosgAsU
Fee payer: 8yHvTk3CW97d97TX5jBkheTqA83TZRuJosgAsV
📖 Loading collateral account from blockchain...
Current collateral state:
  Name: MyCollateral
  Admin threshold: 1
  Admin nonce: 42
New admin will be: 3WdDdKJaZmn2QDTWR8xVzjdHLZQmqzjdwMNXyz
📝 Creating and submitting admin signatures...
Signature transaction: 2Z8X...
All 1 transaction(s) finalized successfully
🔄 Executing admin transfer...
Transfer transaction: 3Y9Z...
All 1 transaction(s) finalized successfully
✅ Collateral admin transfer completed successfully!
The collateral account is now administered by 3WdDdKJaZmn2QDTWR8xVzjdHLZQmqzjdwMNXyz
```

## ⚠️ Important Security Notes

- **Keep private keys safe**: Never share your private keys or commit them to version control
- **Test first**: Use Solana devnet for testing before running on mainnet
- **Verify addresses**: Double-check all addresses before running - blockchain transactions are irreversible
- **Back up**: Make sure the new admin has a secure backup of their private key
- **Current admin loses control**: After this script runs, the current admin will NO LONGER have control

## 🐛 Troubleshooting

### Common Errors

| Error                                             | Cause                   | Solution                                                  |
| ------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| "SOLANA_RPC_URL environment variable is required" | Missing RPC URL         | Add `SOLANA_RPC_URL` to your `.env.local` file            |
| "No secret key provided"                          | Missing private keys    | Add `CURRENT_ADMIN_PK` and `FEE_PAYER_PK` to `.env.local` |
| "Transaction not found"                           | Network issues          | Wait and retry, or try a different RPC endpoint           |
| "Insufficient funds"                              | Not enough SOL for fees | Add SOL to the fee payer account                          |

### Getting Help

- Check that all addresses are valid Solana addresses (Base58 encoded)
- Ensure you have the correct program ID for your collateral
- Make sure the current admin key actually has admin rights on the collateral
- Verify you're connecting to the right Solana network (mainnet vs devnet)

## 🧪 Testing Locally

This section guides you through testing the collateral transfer script on a local Solana validator, which is perfect for development and testing without using real tokens or paying actual fees.

### Prerequisites: Install Solana CLI

If you don't have Solana CLI installed:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

For more details, see the [Solana Test Validator Guide](https://solana.com/developers/guides/getstarted/solana-test-validator).

### Step 1: Start Local Validator

Start a local Solana validator that clones necessary accounts from devnet:

```bash
solana-test-validator \
        --reset \
        --quiet \
        --url https://api.devnet.solana.com \
        --clone <collateralAddress> \
        --clone <currentAdminAddress> \
        --clone <newAdminAddress> \
        --clone-upgradeable-program <programId>
```

**What this does:**

- `--reset`: Starts with a clean state
- `--quiet`: Reduces verbose output
- `--url`: Sources account data from devnet
- `--clone`: Copies specific accounts to your local validator
- `--clone-upgradeable-program`: Copies the program code

### Step 2: Run the Transfer Script

Run the transfer against your local validator:

```bash
NODE_ENV=example yarn solana:collateral-transfer <collateralAddress> <programId> <newAdminAddress>
```

**Note:** Make sure your `.env.example` file has:

```bash
SOLANA_RPC_URL=http://localhost:8899
CURRENT_ADMIN_PK=<bs58 value>
FEE_PAYER_PK=<bs58 value>
```

### Step 3: Verify Transaction Success

#### 3.1 Get Recent Transactions

Query the local validator to see recent transactions for your collateral address:

```bash
curl http://localhost:8899 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getSignaturesForAddress",
    "params": [
      "<collateralAddress>",
      { "limit": 5 }
    ]
  }'
```

**Example Response:**

```json
{
  "jsonrpc": "2.0",
  "result": [
    {
      "blockTime": 1755636145,
      "confirmationStatus": "finalized",
      "err": null,
      "signature": "4AuD89Zr2w9XYnrurBkDTsnsufWAiHNicr5MLuwet51Ygc9agEzXn2JEkGGKK2LEAwRWRZaWr9KMkqZ979NNuHvp",
      "slot": 52
    }
  ],
  "id": 1
}
```

#### 3.2 Get Detailed Transaction Data

Use the transaction signature from step 3.1 to get detailed transaction information:

```bash
curl http://localhost:8899 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getTransaction",
    "params": [
      "YourTransactionSignatureFromStep3.1",
      { "encoding": "jsonParsed", "commitment": "confirmed" }
    ]
  }'
```

**What to look for in the response:**

- `"err": null` - Transaction succeeded
- `"Program log: Instruction: TransferCollateralTeam"` - Correct instruction was called
- `"Program ... success"` - Program executed successfully

### 🔍 Troubleshooting Local Testing

| Issue                | Cause                   | Solution                                                                 |
| -------------------- | ----------------------- | ------------------------------------------------------------------------ |
| "Connection refused" | Validator not running   | Start `solana-test-validator` first                                      |
| "Account not found"  | Missing cloned accounts | Add missing accounts to `--clone` parameters                             |
| "Program not found"  | Missing program         | Ensure `--clone-upgradeable-program` is correct                          |
| "Insufficient funds" | No SOL in test accounts | Airdrop SOL: `solana airdrop 10 YourAddress --url http://localhost:8899` |

### 💡 Local Testing Benefits

- **Free transactions**: No real SOL costs
- **Fast iterations**: Instant resets with `--reset`
- **Safe environment**: No risk to real assets
- **Full control**: Complete blockchain state control
- **Debugging**: Access to detailed logs and state

## 🔗 Related Documentation

- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Solana CLI Documentation](https://docs.solana.com/cli)
