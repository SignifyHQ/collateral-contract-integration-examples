/**
 * SOLANA COLLATERAL TEAM TRANSFER SCRIPT
 *
 * This script transfers administrative control of a Solana collateral account from current admins to new admins.
 * It uses EIP-712 style cryptographic signatures for secure multi-signature operations.
 *
 * WHAT IT DOES:
 * 1. Connects to a Solana collateral management program
 * 2. Loads an existing collateral account with current admin configuration
 * 3. Creates and signs a transfer request using current admin's private key
 * 4. Submits the signed request to the blockchain
 * 5. Executes the transfer, replacing current admin with new admin
 *
 * REQUIREMENTS:
 * - Node.js environment with required dependencies
 * - Environment variables: SOLANA_RPC_URL, CURRENT_ADMIN_PK, FEE_PAYER_PK
 * - Current admin's private key (Base58 encoded)
 * - Fee payer's private key (Base58 encoded)
 * - Solana RPC endpoint URL
 * - Target collateral account address
 * - Solana program ID that manages the collateral
 * - New admin's public key address
 *
 * USAGE:
 * ts-node transferTeam.ts <collateralAddress> <programId> <newAdminAddress>
 *
 * EXAMPLE:
 * ts-node transferTeam.ts 7xKXtg2CW87d97TX******5jBkheTqA83TZRuJosgAsU \
 *                        5ZWj7a1f122312QsY******GqAoECZYHBPzJHRLZMXab \
 *                        3WdDdKJaZmn2QDTWR******8xVzjdHLZQmqzjdwMNXyz
 *
 * SECURITY NOTE:
 * This script requires access to private keys. Ensure you're running it in a secure environment
 * and that private keys are properly protected.
 */

import { AnchorProvider, IdlAccounts, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Ed25519Program, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { randomBytes } from "crypto";
import crypto from "crypto-js";
import nacl from "tweetnacl";
import dotenv from "dotenv";
import MainIdl from "../../idl/main.json";
import { Main } from "../../types/main";
import bs58 from "bs58";
import path from "path";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

// ---------------------CONSTANTS---------------------
const INSTRUCTION_INDEX = 2 ** 16 - 1;
const SIGNATURE_STRUCTURE_SIZE = 14;
const PUBKEY_SIZE = 32;
const SIGNATURE_SIZE = 64;
const MESSAGE_SIZE = 32;
const SIGNATURE_DATA_SIZE = PUBKEY_SIZE + SIGNATURE_SIZE + MESSAGE_SIZE;
const SIGNATURE_DATA_PLUS_STRUCTURE_SIZE = SIGNATURE_STRUCTURE_SIZE + SIGNATURE_DATA_SIZE;

const MAX_TRANSACTION_RETRIES = 10;
const POLL_INTERVAL = 2000;

// ---------------------TYPES---------------------
type Base58SecretKey = string;
type Base58PublicKey = string;

type SignatureVerificationData = {
  signer: PublicKey;
  signature: Buffer;
  message: Buffer;
};

type TransferCollateralTeamRequest = {
  newName: string;
  newAdmins: PublicKey[];
  newAdminThreshold: number;
};

type TransferCollateralTeamParams = {
  collateralAddress: Base58PublicKey;
  programId: Base58PublicKey;
  newAdminAddress: Base58PublicKey;
};

interface ISignatureMessage {
  encode(): string;
}

// ---------------------CRYPTOGRAPHIC UTILITIES---------------------
/**
 * Cryptographic hashing utilities for EIP-712 style message signing
 *
 * This class provides Keccak-256 hashing functions required for creating
 * EIP-712 structured data signatures. These signatures ensure the integrity
 * and authenticity of transfer requests.
 */
class HashUtils {
  /**
   * Converts hex-encoded data to Keccak-256 hash
   * Used for hashing already hex-encoded structured data
   */
  static keccak256Hex(data: string): string {
    const wordArray = crypto.enc.Hex.parse(data);
    const hash = crypto.SHA3(wordArray, { outputLength: 256 });
    return hash.toString();
  }

  /**
   * Converts string data to Keccak-256 hash
   * Used for hashing plain string data like domain names and field values
   */
  static keccak256(data: string): string {
    const hash = crypto.SHA3(data, { outputLength: 256 });
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
    return value.toBuffer().toString("hex");
  }

  /**
   * Encodes the given unsigned integer as a hex string
   * @param value - The unsigned integer to encode
   * @returns The encoded unsigned integer as a hex string
   */
  static encodeUInt32(value: bigint | number): string {
    return value.toString(16).padStart(8, "0");
  }

  /**
   * Encodes the given unsigned integer as a hex string
   * @param value - The unsigned integer to encode
   * @returns The encoded unsigned integer as a hex string
   */
  static encodeUInt64(value: bigint): string {
    return value.toString(16).padStart(16, "0");
  }

  /**
   * Encodes the given bytes as a hex string
   * @param value - The bytes to encode
   * @returns The encoded bytes as a hex string
   */
  static encodeBytes(value: Uint8Array): string {
    return Array.from(value)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Encodes an array of addresses to a keccak256 hash.
   * @param value - The array of addresses to encode.
   * @returns The keccak256 hash of the array of addresses.
   */
  static encodeAddressArray(value: PublicKey[]): string {
    const hexAddresses = value.map((address) => address.toBuffer().toString("hex"));
    return HashUtils.keccak256Hex(hexAddresses.join(""));
  }
}

// ---------------------BLOCKCHAIN CONNECTION UTILITIES---------------------

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

/**
 * Monitors transaction confirmation status on Solana blockchain
 *
 * This function continuously polls the Solana network to check if submitted transactions
 * have been finalized (permanently confirmed) on the blockchain. It's essential because
 * Solana transactions can take time to be processed and confirmed by validators.
 *
 * Transaction states: Processed -> Confirmed -> Finalized
 * - Processed: Transaction included in a block but not yet confirmed
 * - Confirmed: Transaction confirmed by supermajority of validators
 * - Finalized: Transaction is irreversible (what we want)
 *
 * @param signatures - Array of transaction signatures/hashes to monitor
 * @param connection - Active connection to Solana RPC node
 * @returns Promise that resolves when ALL transactions reach 'finalized' status
 * @throws Error if any transaction fails or is dropped by the network
 */
async function waitForTransaction(signatures: string[], connection: Connection): Promise<void> {
  if (signatures.length === 0) {
    return;
  }

  // Poll transaction status until all are finalized
  await new Promise(async (resolve, reject) => {
    let attempts = 1;
    let areFinalized = false;

    while (true) {
      // Query current status of all transactions from the network
      const { value: statuses } = await connection.getSignatureStatuses(signatures, {
        searchTransactionHistory: true, // Check both recent and historical transactions
      });

      // Verify each transaction's status
      for (const [index, status] of statuses.entries()) {
        if (!status) {
          // Transaction not found - may be dropped or still processing
          console.warn(`Transaction ${signatures[index]} not found on-chain (may be dropped or still processing)`);
          if (attempts > MAX_TRANSACTION_RETRIES) {
            reject(new Error(`Transaction ${signatures[index]} not found after ${MAX_TRANSACTION_RETRIES} attempts`));
          }
          break;
        }

        if (status.err) {
          // Transaction failed - this is permanent
          reject(new Error(`Transaction ${signatures[index]} failed: ${JSON.stringify(status.err)}`));
        }

        // Check if this transaction has reached finalized status
        areFinalized = status.confirmationStatus === "finalized";
        if (!areFinalized) {
          break; // At least one transaction is not finalized yet
        }
      }

      if (areFinalized) {
        console.log(`All ${signatures.length} transaction(s) finalized successfully`);
        resolve(statuses);
        break;
      }

      // Wait before checking again to avoid overwhelming the RPC
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      attempts++;
    }
  });
}

// ---------------------SIGNATURES---------------------

class SignatureStructure {
  /**
   * The offset of the public key in the instruction data
   */
  readonly publicKeyOffset: number;
  /**
   * The offset of the signature in the instruction data
   */
  readonly signatureOffset: number;
  /**
   * The offset of the message in the instruction data
   */
  readonly messageOffset: number;
  /**
   * The offset of the structure in the instruction data
   */
  readonly structureOffset: number;

  constructor(signatureIndex: number, signaturesStartOffset: number) {
    // Calculate the offsets
    this.structureOffset = signatureIndex * SIGNATURE_STRUCTURE_SIZE + 2;
    this.publicKeyOffset = signatureIndex * SIGNATURE_DATA_SIZE + signaturesStartOffset;
    this.signatureOffset = this.publicKeyOffset + 32;
    this.messageOffset = this.signatureOffset + 64;
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(SIGNATURE_STRUCTURE_SIZE);
    buffer.writeUInt16LE(this.signatureOffset, 0);
    buffer.writeUInt16LE(INSTRUCTION_INDEX, 2);
    buffer.writeUInt16LE(this.publicKeyOffset, 4);
    buffer.writeUInt16LE(INSTRUCTION_INDEX, 6);
    buffer.writeUInt16LE(this.messageOffset, 8);
    buffer.writeUInt16LE(MESSAGE_SIZE, 10);
    buffer.writeUInt16LE(INSTRUCTION_INDEX, 12);
    return buffer;
  }
}

class Ed25519ExtendedProgram extends Ed25519Program {
  static createSignatureVerificationInstruction(signatures: SignatureVerificationData[]): TransactionInstruction {
    // Define the data buffer. We add 2 bytes for the number of signatures and padding bytes
    const dataBuffer: any = Buffer.alloc(signatures.length * SIGNATURE_DATA_PLUS_STRUCTURE_SIZE + 2);

    // We write the number of signatures in the first byte of the data buffer
    dataBuffer.writeUInt8(signatures.length, 0);

    // Calculate the byte position where the signatures will be written
    const signaturesStartOffset = signatures.length * SIGNATURE_STRUCTURE_SIZE + 2;
    // Write the signatures
    for (let i = 0; i < signatures.length; i++) {
      // Get the signature data
      const { signer, signature, message } = signatures[i];
      if (signature.length !== SIGNATURE_SIZE) {
        throw new Error(`Signature size must be ${SIGNATURE_SIZE} bytes`);
      } else if (message.length !== MESSAGE_SIZE) {
        throw new Error(`Message size must be ${MESSAGE_SIZE} bytes`);
      }

      // Create the signature structure
      const signatureOffset = new SignatureStructure(i, signaturesStartOffset);
      // Write the signature structure
      signatureOffset.toBuffer().copy(dataBuffer, signatureOffset.structureOffset);
      // Write the signature data
      signer.toBuffer().copy(dataBuffer, signatureOffset.publicKeyOffset);
      signature.copy(dataBuffer, signatureOffset.signatureOffset);
      message.copy(dataBuffer, signatureOffset.messageOffset);
    }

    // Create the instruction
    return new TransactionInstruction({
      keys: [],
      programId: super.programId,
      data: dataBuffer,
    });
  }
}

// ---------------------MESSAGES---------------------

/**
 * Message that represents the transfer collateral team request.
 */
class TransferCollateralTeamMessage {
  static TRANSFER_TEAM_TYPE_HASH = HashUtils.encodeString(
    "TransferTeam(address[] addingAdmins,string newName,uint256 nonce)"
  );

  readonly newAdmins: PublicKey[];
  readonly newName: string;
  readonly nonce: number;

  constructor(request: TransferCollateralTeamRequest, nonce: number) {
    this.newAdmins = request.newAdmins;
    this.newName = request.newName;
    // This nonce is the current nonce value of the collateral admin data account.
    this.nonce = nonce;
  }

  encode(): string {
    // Encode the structure
    const encodedStructure = [
      TransferCollateralTeamMessage.TRANSFER_TEAM_TYPE_HASH,
      HashUtils.encodeAddressArray(this.newAdmins),
      HashUtils.encodeString(this.newName),
      HashUtils.encodeUInt32(this.nonce),
    ].join("");
    // Hash and return the structure
    const hashedStructure = HashUtils.keccak256Hex(encodedStructure);
    return hashedStructure;
  }
}

// ---------------------SIGNATURES MESSAGE BUILDER---------------------

class SignatureMessageBuilder {
  buildMessage(messageStructures: ISignatureMessage[]): Buffer {
    const encodedData = messageStructures
      .map((structure) => {
        return structure.encode();
      })
      .join("");

    const encodedDataHash = HashUtils.keccak256Hex(encodedData);
    return Buffer.from(encodedDataHash, "hex");
  }
}

class PaddingBytesMessage implements ISignatureMessage {
  encode(): string {
    const encoded = HashUtils.encodeBytes(new Uint8Array(Buffer.from("\x19\x01", "latin1")));
    return encoded;
  }
}

class DomainSeparatorMessage implements ISignatureMessage {
  static DOMAIN_TYPE_HASH = HashUtils.encodeString(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"
  );

  readonly name: string;
  readonly version: string;
  readonly chainId: bigint;
  readonly verifyingContract: PublicKey;
  readonly salt: Uint8Array;

  constructor(name: string, version: string, chainId: bigint, verifyingContract: PublicKey, salt: Uint8Array) {
    this.name = name;
    this.version = version;
    this.chainId = chainId;
    this.verifyingContract = verifyingContract;
    this.salt = salt;
  }

  encode(): string {
    // Encode the domain separator message structure
    const encodedStructure = [
      DomainSeparatorMessage.DOMAIN_TYPE_HASH,
      HashUtils.encodeString(this.name),
      HashUtils.encodeString(this.version),
      HashUtils.encodeUInt64(this.chainId),
      HashUtils.encodeAddress(this.verifyingContract),
      HashUtils.encodeBytes(this.salt),
    ].join("");

    // Hash and return the domain separator message
    const hashedStructure = HashUtils.keccak256Hex(encodedStructure);
    return hashedStructure;
  }
}

// ---------------------COLLATERAL---------------------

/**
 * Represents a Solana collateral account with administrative controls
 *
 * A collateral account manages funds or assets on Solana with multi-signature
 * administrative controls. This class provides methods to interact with
 * collateral accounts and generate the cryptographic messages needed for
 * admin transfers.
 */
class Collateral {
  /**
   * Program-derived address seed for collateral accounts
   * Used by Solana to deterministically generate account addresses
   */
  static SEED = Buffer.from("Collateral", "utf-8");

  /**
   * The collateral account address
   */
  readonly address: PublicKey;

  /**
   * The nonce related to the collateral account management
   */
  readonly adminDataNonce: number;

  constructor(pk: PublicKey, account: IdlAccounts<Main>["collateral"]) {
    this.address = pk;
    this.adminDataNonce = account.adminDataNonce;
  }

  /**
   * Derivate Collateral public key using an ID and the Main program ID
   * @param id - The Collateral account ID
   * @param coordinator - The Coordinator account address
   * @param programId - The Main program ID
   * @returns - Collateral account public key
   */
  static generatePDA(id: PublicKey, coordinator: PublicKey, programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync([Collateral.SEED, id.toBuffer(), coordinator.toBuffer()], programId);

    return pda;
  }

  /**
   * Gets the transfer collateral team messages
   * @param request - The transfer collateral team instruction data
   * @param salt - A random salt to generate the message
   * @returns - The transfer collateral team message as buffer to be signed by the admin
   */
  getTransferCollateralTeamMessage(request: TransferCollateralTeamRequest, salt: number[]): Buffer {
    // Create the message builder
    const messageBuilder = new SignatureMessageBuilder();
    // Create the message
    const messageStructure = [
      new PaddingBytesMessage(),
      new DomainSeparatorMessage("Collateral", "2", 900n, this.address, new Uint8Array(salt)),
      new TransferCollateralTeamMessage(request, this.adminDataNonce),
    ];

    return messageBuilder.buildMessage(messageStructure);
  }
}

class CollateralAdminSignatures {
  // Static properties for any Coordinator Admin Signatures state account
  /**
   * Seed used to derivate the account address
   */
  static SEED = Buffer.from("CollateralAdminSignatures", "utf-8");

  /**
   * Derivate the account address using the collateral account ID and the Main program ID
   * @param collateral - The collateral account ID
   * @param id - The action message hash as ID
   * @param programId - The Main program ID
   * @returns - The account address
   */
  static generatePDA(collateral: PublicKey, id: Buffer, programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [CollateralAdminSignatures.SEED, collateral.toBuffer(), id],
      programId
    );
    return pda;
  }

  /**
   * Generate the PDA for the TransferCollateralTeam action
   * @param collateral - The collateral account
   * @param request - The request to transfer the collateral team
   * @param programId - The Main program ID
   * @returns The PDA for the TransferCollateralTeam action
   */
  static generateTransferCollateralTeamPDA(
    collateral: Collateral,
    request: TransferCollateralTeamRequest,
    programId: PublicKey
  ): PublicKey {
    const transferCollateralTeamMessageEncoded = new TransferCollateralTeamMessage(
      request,
      collateral.adminDataNonce
    ).encode();
    const id = Buffer.from(transferCollateralTeamMessageEncoded, "hex");
    return CollateralAdminSignatures.generatePDA(collateral.address, id, programId);
  }
}

// ---------------------SIGNATURES GENERATORS---------------------

type TransferCollateralTeamSignaturesSubmission = {
  "0": TransferCollateralTeamRequest;
};

type SignatureSubmissionType = {
  transferCollateralTeam?: TransferCollateralTeamSignaturesSubmission;
};

type SignaturesSubmissionRequest = {
  targetNonce: number;
  salts: number[][];
  signatureSubmissionType: SignatureSubmissionType;
};

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

/**
 * MAIN EXECUTION FUNCTION
 *
 * Orchestrates the complete collateral admin transfer process:
 * 1. Validates environment and connects to blockchain
 * 2. Loads current collateral account state
 * 3. Creates and signs transfer request with current admin's key
 * 4. Submits signed request to blockchain for verification
 * 5. Executes the transfer, replacing current admin with new admin
 *
 * IMPORTANT: This preserves the collateral's name and admin threshold,
 * only changing the admin addresses. This is a complete replacement,
 * not an addition to existing admins.
 */
async function main({ collateralAddress, programId, newAdminAddress }: TransferCollateralTeamParams) {
  console.log("🚀 Starting collateral admin transfer process...");

  // Load and validate private keys from environment
  const currentAdmin = getSecretKey(process.env.CURRENT_ADMIN_PK);
  const feePayer = getSecretKey(process.env.FEE_PAYER_PK);
  console.log(`Current admin: ${currentAdmin.publicKey.toBase58()}`);
  console.log(`Fee payer: ${feePayer.publicKey.toBase58()}`);

  // Connect to the Solana program (smart contract)
  const program: Program<Main> = getProgram(programId, feePayer);

  // Fetch current state of the collateral account from blockchain
  console.log("📖 Loading collateral account from blockchain...");
  const collateralPublicKey = new PublicKey(collateralAddress);
  const collateralAccount = await program.account.collateral.fetch(collateralPublicKey);
  const collateral: Collateral = new Collateral(collateralPublicKey, collateralAccount);

  console.log(`Current collateral state:`);
  console.log(`  Name: ${collateralAccount.name}`);
  console.log(`  Admin threshold: ${collateralAccount.adminThreshold}`);
  console.log(`  Admin nonce: ${collateral.adminDataNonce}`);

  // Prepare the transfer request (preserves name and threshold, changes admin)
  const transferCollateralTeam = {
    newName: collateralAccount.name, // Keep existing name
    newAdmins: [new PublicKey(newAdminAddress)], // Replace with new admin
    newAdminThreshold: collateralAccount.adminThreshold, // Keep existing threshold
  };
  console.log(`New admin will be: ${newAdminAddress}`);

  // STEP 1: Create and submit cryptographic signatures for the transfer
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

  // STEP 2: Execute the actual transfer using the verified signatures
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
  await waitForTransaction([tx], program.provider.connection);

  console.log("✅ Collateral admin transfer completed successfully!");
  console.log(`The collateral ${collateralAddress} is now administered by ${newAdminAddress}`);
}

// ---------------------SCRIPT EXECUTION---------------------
/**
 * Command-line argument parsing and script execution
 *
 * Expected arguments:
 * 1. collateralAddress - The Solana address of the collateral account to transfer
 * 2. programId - The Solana program ID (smart contract) that manages collateral
 * 3. newAdminAddress - The Solana address of the new admin who will control the collateral
 *
 * Example usage:
 * ts-node transferTeam.ts 7xKXtg2CW87d97TX******5jBkheTqA83TZRuJosgAsU 5ZWj7a1f122312QsY******GqAoECZYHBPzJHRLZMXab 3WdDdKJaZmn2QDTWR******8xVzjdHLZQmqzjdwMNXyz
 */

const collateralAddress = process.argv[2]; // Target collateral account
const programId = process.argv[3]; // Solana program (smart contract) ID
const newAdminAddress = process.argv[4]; // New admin's public key

// Validate required arguments
if (!collateralAddress || !programId || !newAdminAddress) {
  console.error("❌ Error: Missing required arguments");
  console.error("Usage: ts-node transferTeam.ts <collateralAddress> <programId> <newAdminAddress>");
  console.error(
    "Example: ts-node transferTeam.ts 7xKXtg2CW87d97TX******5jBkheTqA83TZRuJosgAsU 5ZWj7a1f122312QsY******GqAoECZYHBPzJHRLZMXab 3WdDdKJaZmn2QDTWR******8xVzjdHLZQmqzjdwMNXyz"
  );
  process.exit(1);
}

// Execute the transfer
main({
  collateralAddress,
  programId,
  newAdminAddress,
}).catch((error) => {
  console.error("💥 Transfer failed:", error);
  process.exit(1);
});
