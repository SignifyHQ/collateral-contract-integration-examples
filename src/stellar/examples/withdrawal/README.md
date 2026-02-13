# Stellar Withdrawal Script

## What This Script Does

This script demonstrates **automated token withdrawals** from collateral accounts on Stellar using signatures from the Rain API through the Coordinator contract. It works similarly to withdrawing money from a secure digital vault that requires both your signature and the coordinator's approval.

### What is a Withdrawal?

A withdrawal is a **secure approval system** where:
- **Your signature** proves you own the account and approve the withdrawal
- **Coordinator signature** from Rain API provides an additional authorization layer
- **Smart contract verification** ensures everything is legitimate before releasing funds

### Why Would You Use This Script?

- **Automated withdrawals**: Programmatically withdraw tokens from collateral
- **Integration testing**: Test withdrawal flows in development environment

## How It Works

The script follows a **secure multi-step process**:

1. **API Request**: Gets withdrawal signature from Rain API with your parameters
2. **Contract Setup**: Prepares the call to the Coordinator contract
3. **Transaction Execution**: Executes the withdrawal on the Stellar blockchain

This ensures that **only authorized users** can withdraw the correct amounts to the right destinations.

## Prerequisites

Before running this script, you need:

### 1. Environment Setup

Create an environment file based on your `NODE_ENV` in the project root with these variables:

**File naming pattern:** `.env.${NODE_ENV}`
- `.env.local` (default, for NODE_ENV=local)
- `.env.production` (for NODE_ENV=production)

```bash
# Stellar RPC endpoint (where to connect to the blockchain)
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Rain API authentication
RAIN_API_KEY=your_rain_api_key_here
RAIN_API_URL=https://api-dev.raincards.xyz

# Collateral admin's secret key (Stellar format starting with S) - must have admin rights
COLLATERAL_ADMIN_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### 2. Required Information

You need to know these 6 pieces of information:

| Parameter | Description | How to Get It |
|-----------|-------------|---------------|
| `userId` | Your user ID in Rain system | From Rain dashboard or provided by admin |
| `token` | Token contract address to withdraw | Token contract address |
| `amount` | Amount to withdraw (in cents) | Calculate based on token decimals |
| `adminAddress` | Collateral admin's public key | The one paired with secret key in env var |
| `recipientAddress` | Where to send withdrawn tokens | public key |
| `chainId` | Stellar network identifier | `1501` for testnet, `1500` for mainnet |

## How to Run

### Step 1: Install Dependencies

```bash
yarn install
```

### Step 2: Add Stellar SDK Dependency

If not already installed, add the Stellar SDK:

```bash
yarn add @stellar/stellar-sdk
```

### Step 3: Set Up Environment

Create your environment file with the required variables (see Prerequisites above).
- Default: `.env.local` (if no NODE_ENV is set)
- Custom: `.env.${NODE_ENV}` (e.g., `.env.example` for NODE_ENV=example)

### Step 4: Add Script to package.json

Add the following script to your `package.json` if it is not added already:

```json
{
  "scripts": {
    "stellar:withdraw": "yarn build && node dist/src/stellar/examples/withdrawal/index.js"
  }
}
```

### Step 5: Run the Script

```bash
# Using default environment (.env.local)
yarn stellar:withdraw <userId> <token> <amount> <adminAddress> <recipientAddress> <chainId>

# Using specific environment file
NODE_ENV=example yarn stellar:withdraw <userId> <token> <amount> <adminAddress> <recipientAddress> <chainId>
```

### Example

```bash
# Default environment (testnet)
yarn stellar:withdraw \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  100 \
  GD4XASAQ763MV7PTTYJSOCQ2ZSRYTQRUM6KQLDAQJBRMS6ZU6NH6CPEZ \
  GB4V5ZZKBAD2Y46RXZ2WTJPNAO7RZV5PIZC66UXR72WALQFF5DVNVSZI \
  1501

# With specific environment
NODE_ENV=example yarn stellar:withdraw \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  100 \
  GD4XASAQ763MV7PTTYJSOCQ2ZSRYTQRUM6KQLDAQJBRMS6ZU6NH6CPEZ \
  GB4V5ZZKBAD2Y46RXZ2WTJPNAO7RZV5PIZC66UXR72WALQFF5DVNVSZI \
  1501
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

#### Token Contract Address

Common token addresses:
- **USDC (Testnet)**: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- **USDC (Mainnet)**: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`

#### Amount Calculation
The amount must be expressed in cents (e.g., 1.50 USDC = `150`).
- **Example**: To withdraw 1.5 USDC, use amount = `150`

#### Chain ID
- **Testnet**: `1501`
- **Mainnet**: `1500`

### Getting Addresses

#### Admin & Recipient Addresses
- **Admin Address**: Extract the public key from your `COLLATERAL_ADMIN_SECRET`
- **Recipient Address**: Your wallet's public key where you want to receive tokens

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
        "chainId": 1501,
        "controllerAddress": "CCUKU56F2TSTAIBOFIWTYYJ4AOUAQKN7CV5EWJQA32VXAUBMGX62MSID",
        "proxyAddress": "CDLTQA44UE5I5H6X5XC2LMJA7HALSJSKPGWT6JJBCBA4V3PBMEBHVFNX",
        "depositAddress": "GB4V5ZZKBAD2Y46RXZ2WTJPNAO7RZV5PIZC66UXR72WALQFF5DVNVSZI",
        "tokens": [...],
        "contractVersion": 2
    }
]
```

**Extract the parameters:**
- **Collateral Address** = `proxyAddress` field

### Withdrawal Signature Response

When you request a withdrawal signature from the API, you'll receive a response like this:

```json
{
    "status": "ready",
    "signature": {
        "data": "a1b2c3d4e5f6...",
        "salt": "base64EncodedSalt=="
    },
    "expiresAt": "2026-02-15T18:30:00.000Z",
    "sender": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    "chainId": "0x5dd",
    "parameters": [
        "COLLATERAL_ADDRESS",
        "TOKEN_ADDRESS",
        "10000000",
        "RECIPIENT_ADDRESS",
        1771234567,
        [189, 170, 30, 136, ...],
        "signature_hex_string",
    ]
}
```

**Parameters array:**
- `[0]`: Collateral proxy address
- `[1]`: Asset/token address
- `[2]`: Amount (in smallest unit)
- `[3]`: Recipient address
- `[4]`: Expiration timestamp
- `[5]`: Salt (as byte array)
- `[6]`: Signature (hex encoded)
- `[7]`: Rain admin public key (hex encoded)

## What You'll See When Running

```
Signer public key: GD4XASAQ763MV7PTTYJSOCQ2ZSRYTQRUM6KQLDAQJBRMS6ZU6NH6CPEZ

=== Requesting Withdrawal Signature ===
URL: https://api-dev.raincards.xyz/v1/issuing/users/b5cba353-0459-483a-bbff-3033f864ef7b/signatures/withdrawals
Params: {
  "token": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "amount": "100",
  "adminAddress": "GD4XASAQ763MV7PTTYJSOCQ2ZSRYTQRUM6KQLDAQJBRMS6ZU6NH6CPEZ",
  "recipientAddress": "GB4V5ZZKBAD2Y46RXZ2WTJPNAO7RZV5PIZC66UXR72WALQFF5DVNVSZI",
  "chainId": "1501"
}

=== Signature Response ===
Status: ready

=== Extracted Parameters ===
Collateral Proxy: CDLTQA44UE5I5H6X5XC2LMJA7HALSJSKPGWT6JJBCBA4V3PBMEBHVFNX
Asset Address: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Amount (cents): 100
Recipient: GB4V5ZZKBAD2Y46RXZ2WTJPNAO7RZV5PIZC66UXR72WALQFF5DVNVSZI
Expires At: 1770848940

=== Fetching User Contracts ===
Contract found: {...}

=== Executing Withdrawal ===

=== Withdrawal Parameters ===
Coordinator: CCUKU56F2TSTAIBOFIWTYYJ4AOUAQKN7CV5EWJQA32VXAUBMGX62MSID
Collateral: CDLTQA44UE5I5H6X5XC2LMJA7HALSJSKPGWT6JJBCBA4V3PBMEBHVFNX
Asset: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Amount: 100
Recipient: GB4V5ZZKBAD2Y46RXZ2WTJPNAO7RZV5PIZC66UXR72WALQFF5DVNVSZI
Expires At: 1770848940
=============================

Simulating transaction...
Transaction signed
Sending transaction...
Transaction submitted, waiting for confirmation...
Transaction confirmed successfully!

=== Withdrawal Successful ===
Transaction Hash: abc123...

Withdrawal completed successfully!
Transaction hash: abc123...
```

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|--------|----------|
| "RAIN_API_KEY environment variable is required" | Missing API key | Add `RAIN_API_KEY` to your environment file |
| "COLLATERAL_ADMIN_SECRET environment variable is required" | Missing admin secret key | Add `COLLATERAL_ADMIN_SECRET` to your environment file |
| "STELLAR_RPC_URL environment variable is required" | Missing RPC URL | Add `STELLAR_RPC_URL` to your environment file |
| "Rain admin public key not found in signature response" | API response missing public key | Contact Rain support - the API should return the public key in parameters[7] |
| "Contract not found" | Invalid user/collateral combination | Verify userId and that you have collateral contracts |
| "Transaction simulation failed" | Invalid parameters or insufficient funds | Check all addresses and amounts are correct |
| "Transaction failed" | Network error or contract error | Check Stellar explorer for details |

### Getting Help

- Ensure your admin secret key has actual admin rights on the collateral
- Verify the token address is correct for your network (testnet vs mainnet)
- Verify the amount is in cents
- Make sure the recipient address can receive tokens

## Related Documentation

- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar Testnet Explorer](https://stellar.expert/explorer/testnet)
