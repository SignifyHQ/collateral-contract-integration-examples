/**
 * This script demonstrates how to interact with the Solana blockchain using the Anchor framework,
 * specifically focusing on generating and verifying V2 signatures for a withdrawal process.
 * The withdrawal process is implemented as a custom program instruction that allows a user to
 * retrieve funds from their collateral account to their personal wallet.
 *
 * Environment Variables Required:
 * 
 * - RAIN_API_KEY: Your Rain API key for authentication
 *   Example: RAIN_API_KEY=your_api_key_here
 * 
 * - SOLANA_RPC_URL: Solana RPC endpoint URL
 *   Example: SOLANA_RPC_URL=https://api.devnet.solana.com
 * 
 * - COLLATERAL_ADMIN_PK: Base58-encoded private key for collateral admin
 *   Example: COLLATERAL_ADMIN_PK=your_base58_encoded_private_key
 * 
 * Environment Setup:
 * 1. Create .env.local file in project root
 * 2. Add the above environment variables
 * 3. Ensure .env.local is in .gitignore
 * 
 * API Documentation:
 * 
 * This script interacts with the Rain API for Solana V2 signature withdrawal.
 * 
 * Endpoints Used:
 * 
 * 1. GET /v1/issuing/users/{userId}/signatures/withdrawals
 *    Purpose: Retrieve V2 signature for withdrawal
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Query Params: token, amount, adminAddress, recipientAddress, chainId
 *    Response: { status, parameters[] }
 *    Schema: IssuingSignatureGetOneWithdrawalSignatureResponse
 * 
 * 2. GET /v1/issuing/users/{userId}/contracts
 *    Purpose: Get user's contracts for the specified network
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Response: Contract[] with proxyAddress, programAddress, depositAddress
 *    Schema: IssuingUserReadOneParams
 * 
 * Authentication:
 * - All requests require Api-Key header
 * - API key should be stored in RAIN_API_KEY environment variable
 * 
 * Error Handling:
 * - 401: Invalid API key
 * - 400: Invalid parameters
 * - 403: Forbidden (tenant cannot serve consumer)
 * - 500: Server error
 * 
 * Response Format Examples:
 * 
 * Success Response (Withdrawal Signature):
 * {
 *   "status": "completed",
 *   "parameters": [
 *     "collateralProxyAddress",
 *     "assetAddress", 
 *     "amountInCents",
 *     "recipientAddress",
 *     "expiresAt",
 *     "executorPublisherSalt",
 *     "executorPublisherSig"
 *   ]
 * }
 * 
 * Success Response (User Contracts):
 * [
 *   {
 *     "proxyAddress": "CollateralProxyAddress123...",
 *     "programAddress": "ProgramAddress123...",
 *     "depositAddress": "DepositAddress123...",
 *     "controllerAddress": "CoordinatorAddress123..."
 *   }
 * ]
 * 
 * Error Response:
 * {
 *   "error": "Invalid API key",
 *   "code": "UNAUTHORIZED"
 * }
 * 
 * Command Line Usage:
 * node dist/solana/examples/withdrawal/index.js userId token amount adminAddress recipientAddress chainId
 * 
 * Arguments:
 * - userId: The unique identifier for the user requesting the withdrawal
 * - token: The token mint address (as a string) for the SPL token being withdrawn
 * - amount: The amount of tokens to withdraw (as a string, usually in the smallest unit)
 * - adminAddress: The collateral admin's Solana public key (as a string)
 * - recipientAddress: The user's personal Solana public key (as a string) where funds will be sent
 * - chainId: The identifier for the Solana chain/network (e.g., "devnet", "mainnet-beta")
 *
 * Flow & Expectations:
 * 1. The script loads environment variables and sets up Solana/Anchor connections.
 * 2. It prepares the necessary accounts and transaction data for the withdrawal instruction.
 * 3. It requests a V2 signature from the Raincards backend API, passing the required parameters.
 * 4. The backend returns a signature, which the script then uses to authorize and send the withdrawal transaction on-chain.
 * 5. The script may also verify the signature and confirm the transaction.
 *
 * Expected Outcome:
 * - If successful, the withdrawal transaction is signed, sent, and confirmed on the Solana blockchain.
 * - The script outputs transaction details or errors as appropriate.
 */

import axios from "axios";
import dotenv from "dotenv";
import nacl from "tweetnacl";
import { randomBytes } from "crypto";
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
  Account
} from "@solana/spl-token";
import { Ed25519ExtendedProgram, IdlV2_00, MainV2_00 } from "@rain/program";
import path from "path";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

const BASE_URL = process.env.RAIN_API_URL || "https://api-dev.raincards.xyz";

type FetchV2SignatureOpts = {
  userId: string;
  token: string;
  amount: string;
  adminAddress: string;
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

type WithdrawCollateral = {
  amountOfAsset: BN;
  signatureExpirationTime: BN;
  coordinatorSignatureSalt: number[];
}

class Collateral {
  private static COLLATERAL_ADMIN_SIGNATURE_SEED = Buffer.from('CollateralAdminSignatures', 'utf-8');
  private static WITHDRAW_TYPE_HASH = HashUtils.encodeString('Withdraw(address user,address asset,uint256 amount,address recipient,uint256 nonce)');

  /**
   * Derivate the account address using the collateral account ID and the Main program ID
   * @param collateral - The collateral account ID
   * @param id - The action message hash as ID
   * @param programId - The Main program ID
   * @returns - The account address
   */
  static generateAdminSignaturePDA(collateral: PublicKey, id: Buffer, programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Collateral.COLLATERAL_ADMIN_SIGNATURE_SEED,
        collateral.toBuffer(),
        id,
      ],
      programId,
    );
    return pda;
  }

  /**
   * Generate the PDA for the WithdrawCollateral action
   * @param collateral - The collateral account
   * @param sender - The sender of the withdrawal
   * @param receiver - The receiver of the withdrawal
   * @param asset - The asset to withdraw
   * @param request - The request to withdraw the collateral
   * @param adminFundsNonce - The nonce for the admin funds
   * @param programId - The Main program ID
   * @returns The PDA for the WithdrawCollateral action
   */
  static generateWithdrawCollateralPDA(
    collateral: PublicKey,
    sender: PublicKey,
    receiver: PublicKey,
    asset: PublicKey,
    request: WithdrawCollateral,
    adminFundsNonce: number,
    programId: PublicKey,
  ): PublicKey {
    const withdrawCollateralMessageEncoded = Collateral.encodeWithdrawMessage(
      collateral,
      sender,
      receiver,
      asset,
      request,
      adminFundsNonce
    );

    const id = Buffer.from(withdrawCollateralMessageEncoded, 'hex');
    return Collateral.generateAdminSignaturePDA(collateral, id, programId);
  }

  /**
   * Gets the withdraw messages
   * @param sender - The account of the tx sender
   * @param receiver - The account of the collateral funds receiver
   * @param asset - The asset to be withdrawn
   * @param withdraw - The withdraw collateral instruction data
   * @param salt - The salt for the collateral admins signatures
   * @returns - The withdraw message as buffer to be signed by the admins
   */
  static getWithdrawMessage(
    collateral: PublicKey,
    sender: PublicKey,
    receiver: PublicKey,
    asset: PublicKey,
    withdraw: WithdrawCollateral,
    salt: number[],
    adminFundsNonce: number,
  ): Buffer {
    const encodedData = [
      PaddingBytesMessage.encode(),
      DomainSeparatorMessage.encode(
        'Collateral',
        '2',
        900n,
        collateral,
        new Uint8Array(salt),
      ),
      Collateral.encodeWithdrawMessage(collateral, sender, receiver, asset, withdraw, adminFundsNonce),
    ].join('');

    const encodedDataHash = HashUtils.keccak256Hex(encodedData);
    return Buffer.from(encodedDataHash, 'hex');
  }

  /**
   * Encodes the withdraw message
   * @param collateral - The collateral address
   * @param sender - The sender address of the withdrawal
   * @param receiver - The receiver address of the withdrawal
   * @param asset - The asset address to withdraw
   * @param withdraw - The withdraw collateral instruction data
   * @param adminFundsNonce - The nonce for the admin funds
   * @returns The encoded withdraw message
   */
  static encodeWithdrawMessage(
    collateral: PublicKey,
    sender: PublicKey,
    receiver: PublicKey,
    asset: PublicKey,
    withdraw: WithdrawCollateral,
    adminFundsNonce: number,
  ): string {
    const amount = BigInt(withdraw.amountOfAsset.toString());

    // Encode the structure
    const encodedStructure = [
      Collateral.WITHDRAW_TYPE_HASH,
      HashUtils.encodeAddress(sender),
      HashUtils.encodeAddress(collateral),
      HashUtils.encodeAddress(asset),
      HashUtils.encodeUInt64(amount),
      HashUtils.encodeAddress(receiver),
      HashUtils.encodeUInt32(adminFundsNonce),
    ].join('');
    // Hash and return the structure
    const hashedStructure = HashUtils.keccak256Hex(encodedStructure);
    return hashedStructure;
  }
}

class Coordinator {
  private static WITHDRAW_TYPE_HASH = HashUtils.encodeString('Withdraw(address user,address collateral,address asset,uint256 amount,address recipient,uint256 nonce,uint256 expiresAt)');

  /**
   * Encodes the coordinator withdraw message
   * @param collateral - The collateral address
   * @param sender - The sender address of the withdrawal
   * @param receiver - The receiver address of the withdrawal
   * @param asset - The asset address to withdraw
   * @param withdrawRequest - The withdraw collateral instruction data
   * @param adminFundsNonce - The nonce for the admin funds
   * @returns The encoded withdraw message
   */
  static encodeWithdrawMessage(
    collateral: PublicKey,
    sender: PublicKey,
    receiver: PublicKey,
    asset: PublicKey,
    withdrawRequest: WithdrawCollateral,
    adminFundsNonce: number,
  ): string {
    const amount = BigInt(withdrawRequest.amountOfAsset.toString());
    const nonce = adminFundsNonce;
    const expiresAt = BigInt(withdrawRequest.signatureExpirationTime.toString());
    // Encode the structure
    const encodedStructure = [
      Coordinator.WITHDRAW_TYPE_HASH,
      HashUtils.encodeAddress(sender),
      HashUtils.encodeAddress(collateral),
      HashUtils.encodeAddress(asset),
      HashUtils.encodeUInt64(amount),
      HashUtils.encodeAddress(receiver),
      HashUtils.encodeUInt32(nonce),
      HashUtils.encodeUInt64(expiresAt),
    ].join('');

    // Hash and return the structure
    return HashUtils.keccak256Hex(encodedStructure);
  }

  /**
   * Gets the coordinator withdraw message
   * @param collateral - The collateral address
   * @param coordinator - The coordinator address
   * @param sender - The sender address of the withdrawal
   * @param receiver - The receiver address of the withdrawal
   * @param asset - The asset address to withdraw
   * @param withdrawRequest - The withdraw collateral instruction data
   * @param adminFundsNonce - The nonce for the admin funds
   * @returns The coordinator withdraw message
   */
  static getWithdrawMessage(
    collateral: PublicKey,
    coordinator: PublicKey,
    sender: PublicKey,
    receiver: PublicKey,
    asset: PublicKey,
    withdraw: WithdrawCollateral,
    adminFundsNonce: number,
  ): Buffer {
    const encodedData = [
      PaddingBytesMessage.encode(),
      DomainSeparatorMessage.encode(
        'Coordinator',
        '2',
        900n,
        coordinator,
        new Uint8Array(withdraw.coordinatorSignatureSalt),
      ),
      Coordinator.encodeWithdrawMessage(collateral, sender, receiver, asset, withdraw, adminFundsNonce),
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
 * @param sender - The sender of the transaction  
 * @param recipientAddress - The address of the recipient
 * @param mintAddress - The mint address of the token being withdrawn
 * @returns The associated token account address for the recipient
 */
async function getDestinationTokenAccount(
  program: Program<MainV2_00>,
  sender: Keypair,
  recipientAddress: PublicKey,
  mintAddress: PublicKey,
): Promise<Account> {
  return await getOrCreateAssociatedTokenAccount(
    program.provider.connection,
    sender,
    mintAddress,
    recipientAddress,
    false,
    'confirmed',
    { commitment: 'confirmed' },
    TOKEN_PROGRAM_ID
  );
}

/**
 * Get the source token account for the collateral to withdraw from
 * 
 * @param depositAddress - The deposit address of the collateral, which is the token authority account to the collateral
 * @param mintAddress - The mint address of the token being withdrawn
 * @returns The associated token account address for the collateral
 */
async function getSourceTokenAccount(depositAddress: PublicKey, mintAddress: PublicKey) {
  return await getAssociatedTokenAddress(
    mintAddress,
    depositAddress,
    true
  );
}

/**
 * Submits the collateral admin signature to the blockchain for withdrawal verification
 * 
 * @param sender - The sender's keypair that will sign the transaction
 * @param recipientAddress - The recipient's public key
 * @param mintAddress - The mint address of the token being withdrawn
 * @param withdrawRequest - The withdrawal request parameters
 * @param adminFundsNonce - The nonce for the admin funds
 * @param program - The program instance
 * @param collateralAddress - The collateral contract address
 * @returns The collateral admin signature address
 */
async function submitCollateralSignature(
  sender: Keypair,
  recipientAddress: PublicKey,
  mintAddress: PublicKey,
  withdrawRequest: WithdrawCollateral,
  adminFundsNonce: number,
  program: Program<MainV2_00>,
  collateralAddress: PublicKey
) {
  // Generate the collateral admin signature
  const collateralMessageSalt: number[] = Array.from(randomBytes(32)).map(Number)
  const collateralMessage = Collateral.getWithdrawMessage(
    collateralAddress,
    sender.publicKey,
    recipientAddress,
    mintAddress,
    withdrawRequest,
    collateralMessageSalt,
    adminFundsNonce
  )

  const collateralSignature = nacl.sign.detached(Uint8Array.from(collateralMessage), sender.secretKey)

  const collateralSignatureAddress = Collateral.generateWithdrawCollateralPDA(
    collateralAddress,
    sender.publicKey,
    recipientAddress,
    mintAddress,
    withdrawRequest,
    adminFundsNonce,
    program.programId
  );

  const collateralSignatureAccount = await program.account.collateralAdminSignatures.fetchNullable(collateralSignatureAddress);
  if (!collateralSignatureAccount || collateralSignatureAccount.signers.every(signer => !signer.equals(sender.publicKey))) {
    // Create the instruction to submit the admin signature to the signatures account 
    const signatureVereficationInstruction = Ed25519ExtendedProgram.createSignatureVerificationInstruction([{
      signer: sender.publicKey,
      signature: Buffer.from(collateralSignature),
      message: collateralMessage,
    }]);

    // Submit the admin signature to the signatures account 
    const transaction = await program.methods.submitSignatures({
      salts: [collateralMessageSalt],
      targetNonce: adminFundsNonce,
      signatureSubmissionType: {
        withdrawCollateralAsset: {
          sender: sender.publicKey,
          receiver: recipientAddress,
          asset: mintAddress,
          withdrawRequest,
        }
      },
    }).accounts({
      collateral: collateralAddress,
      collateralAdminSignatures: collateralSignatureAddress,
      rentPayer: sender.publicKey,
    }).preInstructions([
      signatureVereficationInstruction
    ]).transaction();


    // Send and confirm the transaction
    const submitSignaturesHash = await sendAndConfirmTransaction(
      program.provider.connection,
      transaction,
      [sender],
      { commitment: 'confirmed' }
    );

    console.log("Collateral admin signature submitted");
    console.log(submitSignaturesHash);
  }
  return collateralSignatureAddress;
}

/**
 * Creates a Program instance for interacting with the on-chain program
 * 
 * @param programAddress - The address of the on-chain program
 * @param signer - The keypair of the signer
 * @param connection - The instance of the connection to the Solana RPC Node
 * @returns A Program instance for interacting with the on-chain program
 */
function getProgram(programAddress: string, signer: Keypair): Program<MainV2_00> {
  const rpcUrl = process.env.SOLANA_RPC_URL
  if (!rpcUrl) {
    throw new Error("No RPC URL provided");
  }

  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })

  // Load the program's Interface Description Language (IDL) which defines 
  // the program's account structures and instruction interfaces
  const idl: any = Object.assign(IdlV2_00, { address: programAddress })

  // Create an AnchorProvider instance to interact with the Solana network 
  // using the specified RPC endpoint and signer
  const opts = AnchorProvider.defaultOptions()
  const provider = new AnchorProvider(
    connection,
    new Wallet(signer),
    opts
  )

  // Create and return a Program instance that provides an interface to interact
  // with the on-chain program using the IDL definition and provider connection
  return new Program<MainV2_00>(idl, provider)
}

/**
 * Executes a withdrawal transaction on the Solana blockchain using the provided 
 * signature and parameters.
 * 
 * @param program - The Anchor program instance
 * @param collateral - The collateral model instance
 * @param depositAddress - The deposit address of the collateral
 * @param sender - The sender's keypair that will sign the transaction
 * @param recipientAddress - The recipient's public key
 * @param mintAddress - The token mint public key
 * @param expiration - The expiration timestamp for the signature
 * @param amountInCents - The withdrawal amount in cents
 * @param signatureSalt - The salt used to generate the coordinator signature
 * @param signatureData - The coordinator signature data
 */
async function executeWithdrawal(
  program: Program<MainV2_00>,
  collateral: PublicKey,
  depositAddress: PublicKey,
  sender: Keypair,
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

  // The withdraw request is the same for both coordinator and collateral admin
  const withdrawRequest: WithdrawCollateral = {
    amountOfAsset,
    signatureExpirationTime: expiresAt,
    coordinatorSignatureSalt: coordinatorMessageSalt,
  };

  const collateralAccount = await program.account.collateral.fetch(collateral)

  // Get the source token account for the collateral to withdraw from
  const collateralTokenAccount = await getSourceTokenAccount(depositAddress, mintAddress)
  console.log("Source token account", collateralTokenAccount.toBase58())

  // Get or create the associated token account for the recipient to receive 
  // the withdrawn tokens
  const destinationTokenAccount = await getDestinationTokenAccount(
    program,
    sender,
    recipientAddress,
    mintAddress,
  );
  console.log("Destination token account", destinationTokenAccount.address.toBase58())

  // Submit the collateral admin signature to the blockchain for withdrawal verification
  const collateralSignatureAddress = await submitCollateralSignature(
    sender,
    recipientAddress,
    mintAddress,
    withdrawRequest,
    collateralAccount.adminFundsNonce,
    program,
    collateral
  );

  const coordinator = await program.account.coordinator.fetch(collateralAccount.coordinator)
  if (!coordinator.executors || coordinator.executors.length === 0) {
    throw new Error('Not executors found in the given coordinator')
  }

  const transaction = await sendAndConfirmTransaction(
    program.provider.connection,
    new Transaction().add(
      // Verify the coordinator signature instruction
      Ed25519ExtendedProgram.createSignatureVerificationInstruction([
        {
          signer: coordinator.executors.find(c => c)!,
          signature: Buffer.from(coordinatorSignature),
          message: Coordinator.getWithdrawMessage(
            collateral,
            collateralAccount.coordinator,
            sender.publicKey,
            recipientAddress,
            mintAddress,
            withdrawRequest,
            collateralAccount.adminFundsNonce,

          )
        }
      ]),
      // Withdraw the collateral asset instruction
      await program.methods.withdrawCollateralAsset(withdrawRequest)
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
        .instruction()
    ),
    [sender],
    { commitment: 'confirmed' }
  );

  console.log("Withdrawal successful")
  console.log("Transaction", transaction)
}

const main = async ({
  userId,
  token,
  amount,
  adminAddress,
  recipientAddress,
  chainId,
}: FetchV2SignatureOpts) => {
  /**
   * Setup signer to send transaction
   * @dev this should be the admin of the collateral contract
   */
  const signerPk = process.env.COLLATERAL_ADMIN_PK;
  if (!signerPk) {
    throw new Error("No signer key provided");
  }
  const secret: any = bs58.decode(signerPk)
  const signer = Keypair.fromSecretKey(secret);

  //build API request
  const signatureUrl = `${BASE_URL}/v1/issuing/users/${userId}/signatures/withdrawals`;
  const params = {
    token,
    amount,
    adminAddress,
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

  //build API request
  const contractsUrl = `${BASE_URL}/v1/issuing/users/${userId}/contracts`;

  // request signature with api key
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

  // Load needed accounts
  const program = getProgram(contract.programAddress, signer)

  await executeWithdrawal(
    program,
    new PublicKey(collateralProxy),
    new PublicKey(contract.depositAddress),
    signer,
    new PublicKey(recipient),
    new PublicKey(assetAddress),
    expiresAt,
    amountInCents,
    executorPublisherSalt,
    executorPublisherSig
  )
};

// Param & header
const userId = process.argv[2];
const token = process.argv[3]; // token to withdraw
const amount = process.argv[4]; // amount of token to withdraw
const adminAddress = process.argv[5]; // should be admin on collateral contract
const recipientAddress = process.argv[6]; // who to send the asset to
const chainId = process.argv[7]; // which chain to perform the withdraw

// Validate environment variables
const apiKey = process.env.RAIN_API_KEY;
if (!apiKey) {
  throw new Error("RAIN_API_KEY environment variable is required");
}

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) {
  throw new Error("SOLANA_RPC_URL environment variable is required");
}

const signerPk = process.env.COLLATERAL_ADMIN_PK;
if (!signerPk) {
  throw new Error("COLLATERAL_ADMIN_PK environment variable is required");
}

if (!userId || !token || !amount || !adminAddress || !recipientAddress || !chainId) {
  throw new Error("Required query parameters not defined");
}
main({ userId, token, amount, adminAddress, recipientAddress, chainId }).catch((ex) =>
  console.error(ex)
);