/**
 * SOLANA V2.2 SINGLE-SIGNER COLLATERAL WITHDRAWAL SCRIPT — SELF-MANAGED TENANT
 *
 * This script demonstrates withdrawal from SingleSignerCollateral accounts on Solana.
 * Unlike V2 multi-sig collaterals, single-signer collaterals require only:
 * - Owner signature (transaction signer)
 * - Coordinator signature (embedded in transaction)
 *
 * This is the SELF-MANAGED TENANT variant of ../single_signer_program_v2_02: identical on-chain flow,
 * but it authorizes against the tenant-level API endpoints (no userId) and defaults to production.
 *
 * Environment Variables Required:
 * 
 * - RAIN_API_KEY: Your Rain API key for authentication
 *   Example: RAIN_API_KEY=your_api_key_here
 * 
 * - SOLANA_RPC_URL: Solana RPC endpoint URL
 *   Example: SOLANA_RPC_URL=https://api.devnet.solana.com
 * 
 * - OWNER_PK: Base58-encoded private key for collateral owner
 *   Example: OWNER_PK=your_base58_encoded_private_key
 * 
 * - RAIN_API_URL: (Optional) Rain API base URL. Defaults to https://api.raincards.xyz (production)
 *   Example: RAIN_API_URL=https://api.raincards.xyz
 * 
 * Environment Setup:
 * 1. Create .env.local file in project root
 * 2. Add the above environment variables
 * 3. Ensure .env.local is in .gitignore
 * 
 * API Documentation:
 * 
 * Endpoints Used:
 * 
 * 1. GET /v1/issuing/tenants/signatures/withdrawals
 *    Purpose: Retrieve V2.2 signature for single-signer withdrawal
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Query Params: token, amount, adminAddress (ownerAddress), recipientAddress, chainId
 *    Note: The API expects 'adminAddress' as the query param name, but it should be the owner's address
 *    Response: { status, parameters[] }
 * 
 * 2. GET /v1/issuing/tenants/contracts
 *    Purpose: Get tenant's contracts for the specified network
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Response: Contract[] with proxyAddress, programAddress, depositAddress
 * 
 * Authentication:
 * - All requests require Api-Key header
 * - API key should be stored in RAIN_API_KEY environment variable
 * 
 * Command Line Usage:
 * node dist/src/solana/examples/withdrawal/single_signer_program_v2_02_tenant/index.js token amount ownerAddress recipientAddress chainId
 * 
 * Arguments:
 * - token: The token mint address (as a string) for the SPL token being withdrawn (or PublicKey.default for SOL)
 * - amount: The amount of tokens to withdraw (as a string, usually in the smallest unit)
 * - ownerAddress: The collateral owner's Solana public key (as a string) - must match OWNER_PK
 * - recipientAddress: The user's personal Solana public key (as a string) where funds will be sent
 * - chainId: The identifier for the Solana chain/network (e.g., "901" for devnet, "900" for mainnet)
 *
 * Key Differences from V2 Multi-Sig:
 * - No collateral admin signatures required
 * - Owner must sign the transaction directly
 * - Uses withdrawSingleSignerCollateralAsset instruction
 * - Only coordinator signature verification needed
 * - Simpler account structure (owner, coordinator, collateral, destination, asset)
 */

import axios from "axios";
import dotenv from "dotenv";
import crypto from 'crypto-js';

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  Account
} from "@solana/spl-token";

import { Ed25519ExtendedProgram, IdlV2_02, MainV2_02 } from "@rain/program";
import path from "path";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

const DEFAULT_BASE_URL = "https://api.raincards.xyz";

type FetchV2_1SignatureOpts = {
  token: string;
  amount: string;
  ownerAddress: string;
  recipientAddress: string;
  chainId: string;
};

class HashUtils {
  /**
   * Hashes the given data using the Keccak-256 algorithm and returns the result as a hex string
   * @param data - The data to hash
   * @returns The hash of the data as a hex string
   */
  static keccak256Hex(data: string): string {
    const wordArray = crypto.enc.Hex.parse(data);
    const hash = crypto.SHA3(wordArray, { outputLength: 256 });
    return hash.toString();
  }

  /**
   * Hashes the given data using the SHA3 hashing algorithm and returns the result as a hex string
   * @param data - The data to hash
   * @returns The hash of the data as a hex string
   */
  static keccak256(data: string): string {
    // Hash the data using the SHA3 hashing algorithm
    const hash = crypto.SHA3(data, { outputLength: 256 });
    // Return the hash as a hex string
    return hash.toString();
  }

  /**
   * Encodes the given string using the Keccak-256 algorithm and returns the result as a hex string
   * @param value - The string to encode
   * @returns The encoded string as a hex string
   */
  static encodeString(value: string): string {
    return HashUtils.keccak256(value);
  }

  /**
   * Encodes the given address as a hex string
   * @param value - The address to encode
   * @returns The encoded address as a hex string
   */
  static encodeAddress(value: PublicKey): string {
    return value.toBuffer().toString('hex');
  }

  /**
   * Encodes the given unsigned integer as a hex string
   * @param value - The unsigned integer to encode
   * @returns The encoded unsigned integer as a hex string
   */
  static encodeUInt32(value: bigint | number): string {
    return value.toString(16).padStart(8, '0');
  }

  /**
   * Encodes the given unsigned integer as a hex string
   * @param value - The unsigned integer to encode
   * @returns The encoded unsigned integer as a hex string
   */
  static encodeUInt64(value: bigint): string {
    return value.toString(16).padStart(16, '0');
  }

  /**
   * Encodes the given bytes as a hex string
   * @param value - The bytes to encode
   * @returns The encoded bytes as a hex string
   */
  static encodeBytes(value: Uint8Array): string {
    return Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

class PaddingBytesMessage {
  static encode(): string {
    return HashUtils.encodeBytes(new Uint8Array(Buffer.from('\x19\x01', 'latin1')));
  }
}

class DomainSeparatorMessage {
  private static DOMAIN_TYPE_HASH = HashUtils.encodeString('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)');

  static encode(
    name: string,
    version: string,
    chainId: bigint,
    verifyingContract: PublicKey,
    salt: Uint8Array,
  ): string {
    // Encode the domain separator message structure
    const encodedStructure = [
      DomainSeparatorMessage.DOMAIN_TYPE_HASH,
      HashUtils.encodeString(name),
      HashUtils.encodeString(version),
      HashUtils.encodeUInt64(chainId),
      HashUtils.encodeAddress(verifyingContract),
      HashUtils.encodeBytes(salt),
    ].join('');

    // Hash and return the domain separator message
    return HashUtils.keccak256Hex(encodedStructure);
  }
}

type WithdrawSingleSignerCollateralAssetRequest = {
  amountInAsset: BN;
  signatureExpirationTime: BN;
  coordinatorSignatureSalt: number[];
}

class Coordinator {
  static WITHDRAW_TYPE_HASH = HashUtils.encodeString('Withdraw(address user,address collateral,address asset,uint256 amount,address recipient,uint256 nonce,uint256 expiresAt)');

  /**
   * Encodes the coordinator withdraw message for single-signer collateral
   * @param collateral - The collateral address
   * @param owner - The owner address of the collateral
   * @param destination - The destination address for withdrawal
   * @param asset - The asset address to withdraw
   * @param amountInAsset - The amount of asset to withdraw
   * @param signatureExpirationTime - The expiration timestamp for the signature
   * @param nonce - The collateral nonce
   * @returns The encoded withdraw message
   */
  static encodeWithdrawMessage(
    collateral: PublicKey,
    owner: PublicKey,
    destination: PublicKey,
    asset: PublicKey,
    amountInAsset: BN,
    signatureExpirationTime: BN,
    nonce: number,
  ): string {
    // Order matches Rust and CoordinatorWithdrawMessage: type_hash, user/owner, collateral address, asset, amount, destination, nonce, expiresAt
    const encodedStructure = [
      Coordinator.WITHDRAW_TYPE_HASH,
      HashUtils.encodeAddress(owner),
      HashUtils.encodeAddress(collateral),
      HashUtils.encodeAddress(asset),
      HashUtils.encodeUInt64(BigInt(amountInAsset.toString())),
      HashUtils.encodeAddress(destination),
      HashUtils.encodeUInt32(nonce),
      HashUtils.encodeUInt64(BigInt(signatureExpirationTime.toString())),
    ].join('');
    const hashedStructure = HashUtils.keccak256Hex(encodedStructure);
    return hashedStructure;
  }

  /**
   * Gets the SingleSignerCollateral withdrawal message for coordinator signature
   * @param coordinator - The coordinator public key
   * @param collateral - The SingleSignerCollateral account
   * @param owner - The owner of the collateral
   * @param receiver - The receiver of the withdrawn assets
   * @param asset - The asset to be withdrawn
   * @param nonce - The collateral nonce
   * @param withdrawRequest - The withdrawal request data
   * @returns The message as a buffer to be signed by the coordinator executor/publisher
   */
  static getWithdrawSingleSignerMessage(
    coordinator: PublicKey,
    collateral: PublicKey,
    owner: PublicKey,
    receiver: PublicKey,
    asset: PublicKey,
    nonce: number,
    withdrawRequest: WithdrawSingleSignerCollateralAssetRequest,
  ): Buffer {
    const encodedData = [
      PaddingBytesMessage.encode(),
      DomainSeparatorMessage.encode(
        'Coordinator',
        '2',
        900n,
        coordinator,
        new Uint8Array(withdrawRequest.coordinatorSignatureSalt),
      ),
      Coordinator.encodeWithdrawMessage(collateral, owner, receiver, asset, withdrawRequest.amountInAsset, withdrawRequest.signatureExpirationTime, nonce),
    ].join('');

    const encodedDataHash = HashUtils.keccak256Hex(encodedData);
    return Buffer.from(encodedDataHash, 'hex');
  }
}

/**
 * Get or create the associated token account for the recipient to receive 
 * the withdrawn tokens
 * 
 * @param program - The program instance
 * @param owner - The owner of the transaction  
 * @param recipientAddress - The address of the recipient
 * @param mintAddress - The mint address of the token being withdrawn
 * @returns The associated token account address for the recipient
 */
async function getDestinationTokenAccount(
  program: Program<MainV2_02>,
  owner: Keypair,
  recipientAddress: PublicKey,
  mintAddress: PublicKey,
  tokenProgramId: PublicKey,
): Promise<Account> {
  return await getOrCreateAssociatedTokenAccount(
    program.provider.connection,
    owner,
    mintAddress,
    recipientAddress,
    false,
    'confirmed',
    { commitment: 'confirmed' },
    tokenProgramId
  );
}

/**
 * Resolve the SPL Token program that owns a mint (classic SPL vs Token-2022).
 *
 * @param connection - An RPC connection
 * @param mintAddress - The token mint to resolve the program for
 * @returns TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
 */
async function resolveMintTokenProgram(connection: Connection, mintAddress: PublicKey): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mintAddress);
  if (!mintInfo) {
    throw new Error(`Mint account ${mintAddress.toBase58()} not found`);
  }
  if (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error(
      `Mint ${mintAddress.toBase58()} is not owned by a known SPL Token program (owner: ${mintInfo.owner.toBase58()})`
    );
  }
  return mintInfo.owner;
}

/**
 * Get the source token account for the collateral to withdraw from
 * 
 * @param depositAddress - The deposit address of the collateral (authority)
 * @param mintAddress - The mint address of the token being withdrawn
 * @returns The associated token account address for the collateral
 */
async function getSourceTokenAccount(depositAddress: PublicKey, mintAddress: PublicKey, tokenProgramId: PublicKey) {
  return await getAssociatedTokenAddress(
    mintAddress,
    depositAddress,
    true,
    tokenProgramId
  );
}

/**
 * Creates a Program instance for interacting with the on-chain program
 * 
 * @param programAddress - The address of the on-chain program
 * @param owner - The keypair of the owner
 * @returns A Program instance for interacting with the on-chain program
 */
function getProgram(programAddress: string, owner: Keypair): Program<MainV2_02> {
  const rpcUrl = process.env.SOLANA_RPC_URL
  if (!rpcUrl) {
    throw new Error("No RPC URL provided");
  }

  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })

  // Load the program's Interface Description Language (IDL)
  const idl: any = Object.assign(IdlV2_02, { address: programAddress })

  // Create an AnchorProvider instance
  const opts = AnchorProvider.defaultOptions()
  const provider = new AnchorProvider(
    connection,
    new Wallet(owner),
    opts
  )

  // Create and return a Program instance
  return new Program<MainV2_02>(idl, provider)
}

/**
 * Executes a withdrawal transaction from a SingleSignerCollateral account
 * 
 * @param program - The Anchor program instance
 * @param collateral - The collateral public key
 * @param depositAddress - The deposit/authority address of the collateral
 * @param owner - The owner's keypair that will sign the transaction
 * @param recipientAddress - The recipient's public key
 * @param mintAddress - The token mint public key (or PublicKey.default for SOL)
 * @param expiration - The expiration timestamp for the signature
 * @param amountInCents - The withdrawal amount
 * @param signatureSalt - The salt used to generate the coordinator signature
 * @param signatureData - The coordinator signature data
 */
async function executeWithdrawal(
  program: Program<MainV2_02>,
  collateral: PublicKey,
  depositAddress: PublicKey,
  owner: Keypair,
  recipientAddress: PublicKey,
  mintAddress: PublicKey,
  expiration: number,
  amountInCents: number,
  signatureSalt: Buffer,
  signatureData: Buffer
) {
  // Load withdraw parameters from the given signature
  const coordinatorMessageSalt: number[] = Array.from(signatureSalt).map(Number)
  const coordinatorSignature: number[] = Array.from(signatureData).map(Number)
  const expiresAt = new BN(expiration)
  const amountOfAsset = new BN(amountInCents)

  // Create the withdraw request
  const withdrawRequest: WithdrawSingleSignerCollateralAssetRequest = {
    amountInAsset: amountOfAsset,
    signatureExpirationTime: expiresAt,
    coordinatorSignatureSalt: coordinatorMessageSalt,
  };

  // Fetch the collateral account
  const collateralAccount = await program.account.singleSignerCollateral.fetch(collateral)
  console.log("Collateral owner:", collateralAccount.owner.toBase58())
  console.log("Collateral nonce:", collateralAccount.nonce)

  // Verify owner matches
  if (!collateralAccount.owner.equals(owner.publicKey)) {
    throw new Error(`Owner mismatch. Expected: ${collateralAccount.owner.toBase58()}, Got: ${owner.publicKey.toBase58()}`);
  }

  // Get token accounts (null for SOL withdrawals)
  let collateralTokenAccount: PublicKey | null = null;
  let destinationTokenAccount: Account | null = null;
  // Default to classic SPL; resolved from the mint for SPL withdrawals below so Token-2022 mints
  // derive their accounts (and build the instruction) under the correct program.
  let tokenProgramId = TOKEN_PROGRAM_ID;

  if (!mintAddress.equals(PublicKey.default)) {
    // SPL token withdrawal — resolve the mint's token program (classic SPL vs Token-2022)
    tokenProgramId = await resolveMintTokenProgram(program.provider.connection, mintAddress)

    collateralTokenAccount = await getSourceTokenAccount(depositAddress, mintAddress, tokenProgramId)
    console.log("Source token account", collateralTokenAccount.toBase58())

    destinationTokenAccount = await getDestinationTokenAccount(
      program,
      owner,
      recipientAddress,
      mintAddress,
      tokenProgramId,
    );
    console.log("Destination token account", destinationTokenAccount.address.toBase58())
  } else {
    console.log("Withdrawing native SOL")
  }

  // Fetch coordinator to get executor for signature verification
  const coordinator = await program.account.coordinator.fetch(collateralAccount.coordinator)
  if (!coordinator.executors || coordinator.executors.length === 0) {
    throw new Error('No executors found in the given coordinator')
  }

  const coordinatorExecutor = coordinator.executors.find((e: PublicKey) => e)!;
  console.log("Coordinator executor:", coordinatorExecutor.toBase58())

  // Create the transaction with coordinator signature verification
  const transaction = await sendAndConfirmTransaction(
    program.provider.connection,
    new Transaction().add(
      // Verify the coordinator signature instruction
      Ed25519ExtendedProgram.createSignatureVerificationInstruction([
        {
          signer: coordinatorExecutor,
          signature: Buffer.from(coordinatorSignature),
          message: Coordinator.getWithdrawSingleSignerMessage(
            collateralAccount.coordinator,
            collateral,
            owner.publicKey,
            recipientAddress,
            mintAddress,
            collateralAccount.nonce,
            withdrawRequest,
          )
        }
      ]),
      // Withdraw the single-signer collateral asset instruction
      await program.methods.withdrawSingleSignerCollateralAsset(withdrawRequest)
        .accounts({
          owner: owner.publicKey,
          coordinator: collateralAccount.coordinator,
          collateral: collateral,
          destination: recipientAddress,
          asset: mintAddress.equals(PublicKey.default) ? null : mintAddress,
          collateralTokenAccount: collateralTokenAccount,
          destinationTokenAccount: destinationTokenAccount ? destinationTokenAccount.address : null,
          tokenProgram: tokenProgramId,
        })
        .instruction()
    ),
    [owner],
    { commitment: 'confirmed' }
  );

  console.log("Withdrawal successful")
  console.log("Transaction", transaction)
}

const main = async ({
  token,
  amount,
  ownerAddress,
  recipientAddress,
  chainId,
}: FetchV2_1SignatureOpts) => {
  /**
   * Setup owner to send transaction
   * @dev this should be the owner of the single-signer collateral
   */
  const ownerPk = process.env.OWNER_PK;
  if (!ownerPk) {
    throw new Error("No owner key provided");
  }
  const secret: any = bs58.decode(ownerPk)
  const owner = Keypair.fromSecretKey(secret);

  // Verify owner address matches
  if (owner.publicKey.toBase58() !== ownerAddress) {
    throw new Error(`Owner address mismatch. Provided: ${ownerAddress}, Derived: ${owner.publicKey.toBase58()}`);
  }

  const baseUrl = process.env.RAIN_API_URL || DEFAULT_BASE_URL;
  //build API request
  const signatureUrl = `${baseUrl}/v1/issuing/tenants/signatures/withdrawals`;
  const params = {
    token,
    amount,
    adminAddress: ownerAddress,
    recipientAddress,
    chainId,
  };

  // request signature with api key
  const signatureResponse = await axios.get(signatureUrl, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
    params,
  });

  // setup parameters from response
  const { data: signature } = await signatureResponse;
  if (!signature) {
    throw new Error("Invalid signature response received");
  }

  if (signature.status === "failed") {
    throw new Error("Signature generation failed");
  }

  if (signature.status === "pending") {
    throw new Error("Signature is pending");
  }

  if (!signature.parameters || !Array.isArray(signature.parameters)) {
    throw new Error("Invalid signature response: missing or malformed parameters");
  }

  const collateralProxy = signature.parameters[0];
  const assetAddress = signature.parameters[1];
  const amountInCents = signature.parameters[2];
  const recipient = signature.parameters[3];
  const expiresAt = signature.parameters[4];
  const executorPublisherSalt = Buffer.from(signature.parameters[5], "base64");
  const executorPublisherSig = Buffer.from(signature.parameters[6], "base64");

  //build API request for contracts
  const contractsUrl = `${baseUrl}/v1/issuing/tenants/contracts`;

  // request contracts with api key
  const contractsResponse = await axios.get(contractsUrl, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
  });

  const contracts = await contractsResponse.data;
  const contract = contracts.find((c: any) => c.proxyAddress === collateralProxy);
  if (!contract) {
    throw new Error("Contract not found");
  }

  console.log("Contract found:", contract.proxyAddress)
  console.log("Program:", contract.programAddress)
  console.log("Deposit:", contract.depositAddress)

  // Load program
  const program = getProgram(contract.programAddress, owner)

  await executeWithdrawal(
    program,
    new PublicKey(collateralProxy),
    new PublicKey(contract.depositAddress),
    owner,
    new PublicKey(recipient),
    new PublicKey(assetAddress),
    expiresAt,
    amountInCents,
    executorPublisherSalt,
    executorPublisherSig
  )
};

// Param & header
const token = process.argv[2]; // token to withdraw (or PublicKey.default for SOL)
const amount = process.argv[3]; // amount of token to withdraw (in cents)
const ownerAddress = process.argv[4]; // must be owner of single-signer collateral
const recipientAddress = process.argv[5]; // who to send the asset to
const chainId = process.argv[6]; // which chain to perform the withdraw

// Validate environment variables
const apiKey = process.env.RAIN_API_KEY;
if (!apiKey) {
  throw new Error("RAIN_API_KEY environment variable is required");
}

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) {
  throw new Error("SOLANA_RPC_URL environment variable is required");
}

const ownerPk = process.env.OWNER_PK;
if (!ownerPk) {
  throw new Error("OWNER_PK environment variable is required");
}

if (!token || !amount || !ownerAddress || !recipientAddress || !chainId) {
  throw new Error("Required query parameters not defined");
}

main({ token, amount, ownerAddress, recipientAddress, chainId }).catch((ex) =>
  console.error(ex)
);
