/**
 * This script demonstrates how to interact with the Stellar blockchain,
 * specifically focusing on generating and verifying signatures for a withdrawal process
 * using the Coordinator contract.
 * 
 * The withdrawal process allows a user to retrieve funds from their collateral account
 * to their personal wallet using the Rain API signature.
 *
 * Environment Variables Required:
 * 
 * - RAIN_API_KEY: Your Rain API key for authentication
 *   Example: RAIN_API_KEY=your_api_key_here
 * 
 * - STELLAR_RPC_URL: Stellar RPC endpoint URL
 *   Example: STELLAR_RPC_URL=https://soroban-testnet.stellar.org
 * 
 * - COLLATERAL_ADMIN_SECRET: Stellar secret key for collateral admin
 *   Example: COLLATERAL_ADMIN_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 * 
 * Environment Setup:
 * 1. Create .env.local file in project root
 * 2. Add the above environment variables
 * 3. Ensure .env.local is in .gitignore
 * 
 * API Documentation:
 * 
 * This script interacts with the Rain API for Stellar signature withdrawal.
 * 
 * Endpoints Used:
 * 
 * 1. GET /v1/issuing/users/{userId}/signatures/withdrawals
 *    Purpose: Retrieve signature for withdrawal
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Query Params: token, amount, adminAddress, recipientAddress, chainId
 *    Response: { status, parameters[] }
 * 
 * 2. GET /v1/issuing/users/{userId}/contracts
 *    Purpose: Get user's contracts for the specified network
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Response: Contract[] with proxyAddress, controllerAddress, depositAddress
 * 
 * Authentication:
 * - All requests require Api-Key header
 * - API key should be stored in RAIN_API_KEY environment variable
 * 
 * Command Line Usage:
 * yarn stellar:withdraw <userId> <token> <amount> <adminAddress> <recipientAddress> <chainId>
 * 
 * Arguments:
 * - userId: The unique identifier for the user requesting the withdrawal
 * - token: The token contract address (as a string) for the asset being withdrawn
 * - amount: The amount of tokens to withdraw (in cents, e.g., 100 = 1.00)
 * - adminAddress: The collateral admin's Stellar public key (as a string)
 * - recipientAddress: The user's personal Stellar public key (as a string) where funds will be sent
 * - chainId: The identifier for the Stellar chain/network
 *
 * Flow & Expectations:
 * 1. The script loads environment variables and sets up Stellar connections.
 * 2. It requests a signature from the Rain API, passing the required parameters.
 * 3. The backend returns a signature, which the script then uses to call the coordinator's withdraw_assets function.
 * 4. The script sends the transaction to the Stellar network.
 *
 * Expected Outcome:
 * - If successful, the withdrawal transaction is signed, sent, and confirmed on the Stellar blockchain.
 * - The script outputs transaction details or errors as appropriate.
 */

import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import * as StellarSdk from "@stellar/stellar-sdk";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

const BASE_URL = process.env.RAIN_API_URL || "https://api-dev.raincards.xyz";

type FetchSignatureOpts = {
  userId: string;
  token: string;
  amount: string;
  adminAddress: string;
  recipientAddress: string;
  chainId: string;
}; // Note: coordinatorAddress is obtained from controllerAddress in the contracts response

/**
 * Sends a transaction to the Stellar network and polls for confirmation
 * 
 * @param signer - The keypair to sign the transaction
 * @param operation - The operation to execute
 * @param timeout - Transaction timeout in seconds
 * @returns The transaction hash
 */
async function sendTransaction(
  signer: StellarSdk.Keypair,
  operation: StellarSdk.xdr.Operation,
  timeout: number
): Promise<string> {
  const rpcUrl = process.env.STELLAR_RPC_URL;
  if (!rpcUrl) {
    throw new Error("STELLAR_RPC_URL environment variable is required");
  }

  const rpc = new StellarSdk.rpc.Server(rpcUrl);
  const network = await rpc.getNetwork();
  const networkPassphrase = network.passphrase;

  // Get the account
  const account = await rpc.getAccount(signer.publicKey());
  const innerTransaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
  })
    .setNetworkPassphrase(networkPassphrase)
    .addOperation(operation)
    .setTimeout(timeout)
    .build();

  console.log("Simulating transaction...");
  
  // Check if the simulation failed
  const simulationInterResult = await rpc.simulateTransaction(innerTransaction);
  if (StellarSdk.rpc.Api.isSimulationError(simulationInterResult)) {
    throw new Error(
      `Transaction simulation failed: ${simulationInterResult.error}`
    );
  }

  // Prepare the transaction with estimated fees
  const preparedTransaction = await rpc.prepareTransaction(innerTransaction);

  // Sign the transaction
  preparedTransaction.sign(signer);
  console.log("Transaction signed");

  // Simulate the prepared transaction
  const simulationResult = await rpc.simulateTransaction(preparedTransaction);
  if (StellarSdk.rpc.Api.isSimulationError(simulationResult)) {
    throw new Error(`Transaction simulation failed: ${simulationResult.error}`);
  }

  // Send the transaction
  console.log("Sending transaction...");
  const result = await rpc.sendTransaction(preparedTransaction);

  // Check if the transaction was accepted
  if (result.status !== "PENDING") {
    console.log("Transaction result:", result.status);
    throw new Error(
      `Transaction failed: ${result.hash} ${result.status} ${result.errorResult?.toXDR("base64")}`
    );
  }

  console.log(`Transaction ${result.hash} submitted, waiting for confirmation...`);
  // Poll for transaction confirmation
  const attempts = 60; // 60 attempts * 500ms = 30 seconds max wait time
  const pollResult = await rpc.pollTransaction(result.hash, {
    sleepStrategy: (_: number) => 500,
    attempts,
  });

  if (pollResult.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
    console.log("Transaction confirmed");
  } else {
    throw new Error(`Transaction failed with status: ${pollResult.status}`);
  }

  return result.hash;
}

/**
 * Executes a withdrawal from the collateral using the Coordinator contract
 * 
 * @param signer - The keypair of the admin signing the transaction
 * @param coordinatorAddress - The address of the Coordinator contract
 * @param collateralAddress - The address of the Collateral contract
 * @param assetAddress - The address of the asset token
 * @param amount - The amount to withdraw (in smallest unit)
 * @param recipientAddress - The address to receive the withdrawn funds
 * @param expiresAt - The expiration timestamp for the signature
 * @param salt - The salt used for the signature (as byte array or Buffer)
 * @param signature - The coordinator signature (hex encoded)
 * @param rainAdminPublicKey - The Rain admin public key (hex encoded) from API response
 */
async function executeWithdrawal(
  signer: StellarSdk.Keypair,
  coordinatorAddress: string,
  collateralAddress: string,
  assetAddress: string,
  amount: bigint,
  recipientAddress: string,
  expiresAt: number,
  salt: number[] | Buffer,
  signature: string,
  rainAdminPublicKey: string
): Promise<string> {
  console.log("\n=== Withdrawal Parameters ===");
  console.log("Coordinator:", coordinatorAddress);
  console.log("Collateral:", collateralAddress);
  console.log("Asset:", assetAddress);
  console.log("Amount:", amount.toString());
  console.log("Recipient:", recipientAddress);
  console.log("Expires At:", expiresAt);
  console.log("=============================\n");

  const contract = new StellarSdk.Contract(coordinatorAddress);
  
  // Convert salt to Buffer if it's a byte array
  const saltBuffer = Array.isArray(salt) ? Buffer.from(salt) : salt;
  
  // Build the function arguments for withdraw_assets
  const functionName = "withdraw_assets";
  const stellarArgs = [
    StellarSdk.nativeToScVal(signer.publicKey(), { type: "address" }),  // caller
    StellarSdk.nativeToScVal(collateralAddress, { type: "address" }),   // collateral
    StellarSdk.nativeToScVal(assetAddress, { type: "address" }),        // asset
    StellarSdk.nativeToScVal(amount, { type: "i128" }),                 // amount
    StellarSdk.nativeToScVal(recipientAddress, { type: "address" }),    // recipient
    StellarSdk.nativeToScVal(expiresAt, { type: "u64" }),               // expires_at
    StellarSdk.nativeToScVal(saltBuffer),                               // salt
    StellarSdk.nativeToScVal(Buffer.from(signature, "hex")),            // signature
    StellarSdk.nativeToScVal(Buffer.from(rainAdminPublicKey, "hex")),   // rain_admin_public_key
  ];

  const operation = contract.call(functionName, ...stellarArgs);
  const txHash = await sendTransaction(signer, operation, 180);
  
  return txHash;
}

const main = async ({
  userId,
  token,
  amount,
  adminAddress,
  recipientAddress,
  chainId,
}: FetchSignatureOpts) => {
  /**
   * Setup signer to send transaction
   * this should be the admin of the collateral contract
   */
  const signerSecret = process.env.COLLATERAL_ADMIN_SECRET;
  if (!signerSecret) {
    throw new Error("COLLATERAL_ADMIN_SECRET environment variable is required");
  }
  const signer = StellarSdk.Keypair.fromSecret(signerSecret);
  console.log("Signer public key:", signer.publicKey());

  // API request for withdrawal signature
  const signatureUrl = `${BASE_URL}/v1/issuing/users/${userId}/signatures/withdrawals`;
  const params = {
    token,
    amount,
    adminAddress,
    recipientAddress,
    chainId,
  };

  console.log("\n=== Requesting Withdrawal Signature ===");
  console.log("URL:", signatureUrl);
  console.log("Params:", JSON.stringify(params, null, 2));

  // Request signature with API key
  const signatureResponse = await axios.get(signatureUrl, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
    params,
  });

  // Setup parameters from response
  const { data: signature } = signatureResponse;
  if (!signature) {
    throw new Error("Invalid signature response received");
  }

  console.log("\n=== Signature Response ===");
  console.log("Status:", signature.status);

  if (signature.status === "pending") {
    throw new Error("Signature is pending. Please wait and retry.");
  }

  if (!signature.parameters || !Array.isArray(signature.parameters)) {
    throw new Error("Invalid signature response: missing or malformed parameters");
  }

  // Extract parameters from the signature response
  // Parameters order: [collateralProxy, assetAddress, amount, recipient, expiresAt, salt (byte array), signature (hex), rainAdminPublicKey (hex)]
  const collateralProxy = signature.parameters[0];
  const assetAddress = signature.parameters[1];
  const amountValue = signature.parameters[2];
  const recipient = signature.parameters[3];
  const expiresAt = signature.parameters[4];
  const executorPublisherSalt = signature.parameters[5]; // byte array
  const executorPublisherSig = signature.parameters[6];  // hex encoded
  const rainAdminPublicKey = signature.parameters[7];    // hex encoded - Rain admin public key

  console.log("\n=== Extracted Parameters ===");
  console.log("Collateral Proxy:", collateralProxy);
  console.log("Asset Address:", assetAddress);
  console.log("Amount:", amountValue);
  console.log("Recipient:", recipient);
  console.log("Expires At:", expiresAt);

  if (!rainAdminPublicKey) {
    throw new Error("Rain admin public key not found in signature response (parameters[7])");
  }

  // Build API request for contracts
  const contractsUrl = `${BASE_URL}/v1/issuing/users/${userId}/contracts`;

  console.log("\n=== Fetching User Contracts ===");
  
  // Request contracts with API key
  const contractsResponse = await axios.get(contractsUrl, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
  });

  const contracts = contractsResponse.data;
  const contract = contracts.find((c: any) => c.proxyAddress === collateralProxy);
  
  if (!contract) {
    console.log("Available contracts:", JSON.stringify(contracts, null, 2));
    throw new Error(`Contract not found for collateral proxy: ${collateralProxy}`);
  }

  console.log("Contract found:", JSON.stringify(contract, null, 2));

  // Get coordinator address from contract
  const coordinatorAddress = contract.controllerAddress;
  if (!coordinatorAddress) {
    throw new Error("Coordinator address not found in contract response");
  }
  console.log("Coordinator Address:", coordinatorAddress);

  // Execute the withdrawal
  console.log("\n=== Executing Withdrawal ===");
  
  const txHash = await executeWithdrawal(
    signer,
    coordinatorAddress,
    collateralProxy,
    assetAddress,
    BigInt(amountValue),
    recipient,
    expiresAt,
    executorPublisherSalt,
    executorPublisherSig,
    rainAdminPublicKey
  );

  console.log("\n=== Withdrawal Successful ===");
  console.log("Transaction Hash:", txHash);
  
  return txHash;
};

// Parse command line arguments
const userId = process.argv[2];
const token = process.argv[3];              // token to withdraw
const amount = process.argv[4];             // amount of token to withdraw (in cents)
const adminAddress = process.argv[5];       // should be admin on collateral contract
const recipientAddress = process.argv[6];   // who to send the asset to
const chainId = process.argv[7];            // which chain to perform the withdraw

// Validate environment variables
const apiKey = process.env.RAIN_API_KEY;
if (!apiKey) {
  throw new Error("RAIN_API_KEY environment variable is required");
}

const rpcUrl = process.env.STELLAR_RPC_URL;
if (!rpcUrl) {
  throw new Error("STELLAR_RPC_URL environment variable is required");
}

const signerSecret = process.env.COLLATERAL_ADMIN_SECRET;
if (!signerSecret) {
  throw new Error("COLLATERAL_ADMIN_SECRET environment variable is required");
}

// Validate command line arguments
if (!userId || !token || !amount || !adminAddress || !recipientAddress || !chainId) {
  console.error(`
Usage: yarn stellar:withdraw <userId> <token> <amount> <adminAddress> <recipientAddress> <chainId>

Arguments:
  userId            - Your user ID in Rain system
  token             - Token contract address to withdraw
  amount            - Amount to withdraw (in cents, e.g., 100 = 1.00)
  adminAddress      - Collateral admin's Stellar public key
  recipientAddress  - Recipient's Stellar public key
  chainId           - Stellar chain identifier (1501 for testnet, 1500 for mainnet)
  `);
  throw new Error("Required command line arguments not provided");
}

main({ userId, token, amount, adminAddress, recipientAddress, chainId })
  .then((txHash) => {
    console.log("\nWithdrawal completed successfully!");
    console.log("Transaction hash:", txHash);
    process.exit(0);
  })
  .catch((ex) => {
    console.error("\nWithdrawal failed:", ex.message);
    console.error(ex);
    process.exit(1);
  });
