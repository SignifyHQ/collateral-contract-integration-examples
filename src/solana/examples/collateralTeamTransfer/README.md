# Solana Collateral Admin Transfer Script

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
