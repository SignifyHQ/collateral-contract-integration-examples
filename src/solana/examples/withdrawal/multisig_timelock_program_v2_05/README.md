# Solana V2.05 Multisig Timelock Withdrawal Script

## 🎯 What This Script Does

This script demonstrates **timelock (permissionless) withdrawals** from Solana multisig collateral accounts using the v2.05 collateral program. Unlike the signature-based withdrawal (see [multisig_program_v2_01](../multisig_program_v2_01)), **no Rain-issued signature is required** — your admins request the withdrawal fully on-chain and the funds are released after a 7-day timelock unless Rain executes the request early or cancels it.

### What is a Timelock Withdrawal?
A timelock withdrawal is a **request-review-execute system** where:
- **Admin signatures** prove the collateral admins approve the withdrawal (threshold applies)
- **An on-chain request** commits the amount, asset and recipient, and starts a 7-day timelock
- **Rain reviews the request** and usually executes it early (expedited); it can also cancel it with a reason
- **You stay in control**: if Rain does not act, any collateral admin can execute the request after the timelock elapses, or cancel it at any time

### Why Would You Use This Script?
- **No signature dependency**: Withdraw without requesting a signature from the Rain API
- **Guaranteed exit**: Funds are withdrawable by your admins alone once the timelock elapses
- **Full lifecycle**: Request, execute, cancel and track withdrawals from one CLI
- **Integration reference**: The recommended withdrawal path for v2.05 collateral integrations

## 🔧 How It Works

The `request` action is a **2-transaction flow**:

1. **Sign the action**: The admin signs the `RequestPermissionlessWithdrawal` message (collateral, recipient, asset, amount, nonce) with their Ed25519 key
2. **Submit the signature**: An Ed25519 verification instruction plus `submit_signatures` store the signature in an on-chain signatures account. With an admin threshold above 1, each admin re-runs the same command to add their signature
3. **Send the request**: The run that reaches the threshold sends `request_permissionless_withdrawal`, creating the on-chain `WithdrawalRequest` account and printing when it becomes executable
4. **Await review or the timelock**: Rain either executes early or cancels during review; otherwise run `process` after the timelock elapses (or `cancel` at any time)

Key on-chain rules the script handles for you:
- **One live request per collateral + asset pair** — cancel the pending one before requesting again
- **Rent payer rule**: the admin that submitted the first signature must also send the request transaction (the script detects this and tells you who must run it)
- **Governance freeze**: adding/removing admins, changing the threshold or transferring the team invalidates a pending request — cancel it to reclaim the rent and request again

## 📋 Prerequisites

> **Note:** Timelock withdrawals are opt-in per coordinator and disabled by default. Ask Rain to enable them for your coordinator before using this script — until then the `request` action fails with "Timelock withdrawals are not enabled".

Before running this script, you need:

### 1. Environment Setup
Create an environment file based on your `NODE_ENV` next to the script with these variables:

**File naming pattern:** `.env.${NODE_ENV}`
- `.env.local` (default, for NODE_ENV=local)
- `.env.example` (for NODE_ENV=example)

```bash
# Solana RPC endpoint (where to connect to the blockchain)
SOLANA_RPC_URL=https://api.devnet.solana.com

# Rain API authentication
RAIN_API_KEY=your_rain_api_key_here
RAIN_API_URL=https://api-dev.raincards.xyz

# Collateral admin's private key (Base58 encoded) - must have admin rights
COLLATERAL_ADMIN_PK=your_collateral_admin_private_key_here
```

### 2. Required Information

| Parameter | Description | How to Get It |
|-----------|-------------|---------------|
| `action` | `request`, `process`, `cancel` or `list` | Pick the lifecycle step you want to run |
| `userId` | Your user ID in Rain system | From Rain dashboard or provided by admin |
| `collateralAddress` | The collateral account (proxy) address | `proxyAddress` from the contracts API (see Troubleshooting) |
| `amount` | Amount to withdraw in the asset's **base units** | 1 SOL = `1000000000`, 1 USDC = `1000000` (10^decimals) |
| `recipientAddress` | Where to send the withdrawn funds | Your wallet's public key |
| `assetMint` | SPL token mint address, or the literal `SOL` | Token mint address (e.g., USDC mint), `SOL` for native SOL |
| `status` | Optional `list` filter | `PENDING`, `EXECUTED` or `CANCELLED` |
| `chainId` | Optional `list` filter | `"901"` for devnet, `"900"` for mainnet |

## 🚀 How to Run

### Step 1: Install Dependencies
```bash
yarn install
```

### Step 2: Set Up Environment
Create your environment file with the required variables (see Prerequisites above).

### Step 3: Run the Script
```bash
yarn solana:timelock-withdraw:multisig:v2-05 request <userId> <collateralAddress> <amount> <recipientAddress> <assetMint|SOL>
yarn solana:timelock-withdraw:multisig:v2-05 process <userId> <collateralAddress> <assetMint|SOL>
yarn solana:timelock-withdraw:multisig:v2-05 cancel <userId> <collateralAddress> <assetMint|SOL>
yarn solana:timelock-withdraw:multisig:v2-05 list [status] [chainId]
```

### Example
```bash
# Request a 1.5 USDC withdrawal (devnet USDC mint)
yarn solana:timelock-withdraw:multisig:v2-05 request \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7 \
  1500000 \
  CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q \
  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

# Execute it after the timelock elapses (or cancel it at any time with the cancel action)
yarn solana:timelock-withdraw:multisig:v2-05 process \
  b5cba353-0459-483a-bbff-3033f864ef7b \
  5ZPYhy56gKHoG8SuydzTv1eVnHCTggPmHqUx51P7QwN7 \
  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU

# List pending requests on devnet
yarn solana:timelock-withdraw:multisig:v2-05 list PENDING 901
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
- **Native SOL**: pass the literal `SOL`

#### Amount Calculation
Unlike the signature-based scripts, the amount is expressed in the asset's **base units**, not cents:
- **Example**: To withdraw 1.5 USDC (6 decimals), use amount = `1500000`
- **Example**: To withdraw 0.1 SOL (9 decimals), use amount = `100000000`

## 📱 What You'll See When Running

```
Collateral admin funds nonce: [Nonce]
Required signatures: [Threshold]
Admin signature submitted
[TransactionSignature]
Withdrawal requested
Transaction [TransactionSignature]
Amount: 1500000
Recipient: [RecipientPublicKey]
Executable from: 2026-08-07T12:00:00.000Z
Rain now reviews the request: it may execute it early or cancel it. Track it with the list action.
```

With an admin threshold above 1, intermediate runs print instead:
```
1/2 signatures collected.
Re-run this exact command as each remaining admin; the run that reaches the threshold sends the request.
```

## 🐛 Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|--------|----------|
| "RAIN_API_KEY environment variable is required" | Missing API key | Add `RAIN_API_KEY` to your environment file |
| "Contract not found for collateral ..." | Invalid user/collateral combination | Verify userId and the collateral (proxy) address |
| "Timelock withdrawals are not enabled" | The feature is opt-in per coordinator and not enabled for yours (the default) | Contact Rain to enable timelock withdrawals |
| Transaction log "already in use" on request | A request already exists for this collateral + asset | Process or cancel the pending request first (one live request per pair) |
| "The request transaction must be sent by the admin that submitted the first signature" | The program returns the signatures rent to its original payer | Re-run the request command with the printed admin key in `COLLATERAL_ADMIN_PK` |
| "Withdrawal is not yet executable" | The timelock has not elapsed | Wait until the printed `Executable from` date, or let Rain execute it early |
| "Collateral governance changed after approval; the withdrawal request is stale" | Admins/threshold/team changed after the request | Run `cancel` to reclaim the rent, then request again |
| "Insufficient vault balance for withdrawal" | The collateral does not hold the requested amount | Fund the collateral or request a smaller amount |
| "The asset does not match the withdrawal request" | Wrong `assetMint` argument for process/cancel | Pass the same asset the request was created with |
| "The expected amount does not match the withdrawal request" | The pending request changed between fetch and execution (cancelled and re-created at the same address) | Re-run the `process` command — it refetches the request and its amount |
| "Cancellation reason is only allowed for Rain admin cancellations" | A reason was supplied by a non-Rain key | Admins always cancel without a reason (the script does this) |
| "Unauthorized cancellation" / "Signer is not an admin" | The key is not a current collateral admin | Use a current admin key in `COLLATERAL_ADMIN_PK` |

#### Getting Collateral Information

You can get your collateral address and program ID using the Rain API:

```bash
curl --location 'https://api-dev.raincards.xyz/v1/issuing/users/YOUR_USER_ID/contracts' \
--header 'Api-Key: YOUR_API_KEY' \
--header 'accept: application/json'
```

**Extract the parameters:**
- **Collateral Address** = `proxyAddress` field
- **Program ID** = `programAddress` field (resolved automatically by the script)

#### Tracking Requests

The `list` action calls the tenant API directly:

```bash
curl --location 'https://api-dev.raincards.xyz/v1/issuing/time-lock-withdrawals?status=PENDING&chainId=901' \
--header 'Api-Key: YOUR_API_KEY' \
--header 'accept: application/json'
```

**Response Example:**
```json
[
    {
        "id": "0e9f4c2a-8f4b-4f0e-9f37-0f4c1c2d3e4f",
        "withdrawalId": "c2b1a090-1111-4222-8333-444455556666",
        "chainId": "901",
        "requesterAddress": "HFFdJHiEZBgniNh754BPqsCdeNasv3got5wJqRABHnCX",
        "assetAddress": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        "assetAmountNative": "1500000",
        "recipientAddress": "CvXV3wxqcUT7h5iFd6MqQvNuGEYPuipcrt6ZMPgEBr3q",
        "requestedAt": "2026-07-31T12:00:00.000Z",
        "status": "PENDING",
        "intentTransactionHash": "5o1kj...",
        "isUnlocked": false,
        "unlockedAt": "2026-08-07T12:00:00.000Z"
    }
]
```

Cancelled entries include `cancelledAt`, `cancelledBy` and — for Rain-side cancellations — `cancellationReason`.

### Getting Help
- Verify your admin private key belongs to a **current** admin of the collateral
- Check that the amount is in base units (considering the asset's decimals)
- Remember only one request can be pending per collateral + asset pair
- A pending request does not block the signature-based withdrawal flow (and vice versa)

## 🔗 Related Documentation

- [Withdrawal examples overview](../README.md) — timelock flow diagrams and version guide
- [CODING_GUIDELINES.md](../../../../CODING_GUIDELINES.md) — `@rain/program` imports and program version comparison
- [Signature-based multisig withdrawal (v2.01)](../multisig_program_v2_01) — the coexisting signature flow
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
