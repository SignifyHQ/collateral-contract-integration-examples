# Solana V2.2 Single-Signer Collateral Withdrawal Script

## 🎯 What This Script Does

This script demonstrates **automated token withdrawals** from Solana SingleSignerCollateral accounts using V2.2 signatures from the Rain API. Think of it like withdrawing money from a secured digital vault that requires both your signature and approval from the vault's coordinator.

### What is V2.2 Single-Signer Withdrawal?
A V2.2 single-signer withdrawal is a **secure two-party approval system** where:
- **Owner signature** proves you own the collateral account and approve the withdrawal
- **Coordinator signature** from Rain API provides additional authorization layer
- **Smart contract verification** ensures everything is legitimate before releasing funds
- **Token accounts** handle the actual transfer of digital assets

### Why Would You Use This Script?
- **Automated withdrawals**: Programmatically withdraw tokens from single-signer collateral
- **Simplified flow**: No multisig admin signatures required (unlike V2 multi-sig collaterals)
- **Integration testing**: Test withdrawal flows in development environment
- **Production deployments**: Use when collateral is owned by a single signer

## 🔧 How It Works

The script follows a **secure multi-step process**:

1. **API Request**: Gets withdrawal signature from Rain API with your parameters
2. **Account Setup**: Prepares source (collateral) and destination (your wallet) token accounts  
3. **Signature Verification**: Creates cryptographic proof of authorization
4. **Transaction Execution**: Executes the withdrawal on Solana blockchain

This ensures that **only authorized users** can withdraw the correct amounts to the right destinations.

## 📋 Prerequisites

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

# Collateral owner's private key (Base58 encoded) - must be owner of single-signer collateral
OWNER_PK=your_collateral_owner_private_key_here
```

### 2. Required Information
You need to know these 6 pieces of information:

| Parameter | Description | How to Get It |
|-----------|-------------|---------------|
| `userId` | Your user ID in Rain system | From Rain dashboard or provided by admin |
| `token` | SPL token mint address you want to withdraw | Token mint address (e.g., USDC mint) |
| `amount` | Amount to withdraw (in token's smallest unit) | Calculate based on token decimals |
| `ownerAddress` | Collateral owner's public key | Same as the private key you have |
| `recipientAddress` | Where to send withdrawn tokens | Your wallet's public key |
| `chainId` | Solana network identifier | "901" for devnet, "900" for mainnet |

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
yarn solana:withdraw-v2-2 <userId> <token> <amount> <ownerAddress> <recipientAddress> <chainId>

# Using specific environment file
NODE_ENV=example yarn solana:withdraw-v2-2 <userId> <token> <amount> <ownerAddress> <recipientAddress> <chainId>
```

### Example
```bash
# Default environment
yarn solana:withdraw-v2-2 \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  100 \
  HFFdJHiEZBgniNh754BPqsCdeNasv3got5wJqRABHnCX \
  CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q \
  901

# With specific environment
NODE_ENV=example yarn solana:withdraw-v2-2 \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  1000 \
  HFFdJHiEZBgniNh754BPqsCdeNasv3got5wJqRABHnCX \
  CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q \
  901
```

## 📖 Getting the Required Parameters

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

#### Owner & Recipient Addresses
- **Owner Address**: Extract public key from your `OWNER_PK` (must be owner of single-signer collateral)
- **Recipient Address**: Your wallet's public key where you want to receive tokens

#### Chain ID
- **Devnet**: `901`
- **Mainnet**: `900`

## 📱 What You'll See When Running

```
Collateral owner: [OwnerPublicKey]
Collateral nonce: [Nonce]
Source token account: [TokenAccountAddress]
Destination token account: [YourTokenAccountAddress]
Coordinator executor: [ExecutorAddress]
Withdrawal successful
Transaction: [TransactionSignature]
```

## 🐛 Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|--------|----------|
| "RAIN_API_KEY environment variable is required" | Missing API key | Add `RAIN_API_KEY` to your environment file |
| "OWNER_PK environment variable is required" | Missing owner private key | Add `OWNER_PK` to your environment file |
| "Owner address mismatch" | Owner address doesn't match private key | Verify `ownerAddress` matches the public key from `OWNER_PK` |
| "Owner mismatch. Expected: X, Got: Y" | Collateral owner doesn't match provided owner | Verify the collateral is owned by the address from your `OWNER_PK` |
| "Signature is pending" | Rain API hasn't approved yet | Wait a moment and retry |
| "Error: Signature is pending" | Signature generation is still processing | Wait a few seconds and retry the request |
| "Contract not found" | Invalid user/collateral combination | Verify userId and that you have collateral contracts |
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
- Ensure your owner private key matches the collateral owner address
- Check that the token mint address is correct for your network (devnet vs mainnet)
- Verify the amount is in the token's smallest unit (considering decimals)
- Make sure recipient address can receive SPL tokens
- Verify the collateral is a SingleSignerCollateral (not a multi-sig collateral)

## 🔗 Related Documentation

- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Solana CLI Documentation](https://docs.solana.com/cli)
- [SPL Token Documentation](https://spl.solana.com/token)

