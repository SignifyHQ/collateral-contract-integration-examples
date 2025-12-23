/**
 * SOLANA V2.2 SQUADS MULTISIG WITHDRAWAL SCRIPT
 *
 * This script demonstrates withdrawal from SingleSignerCollateral accounts owned by Squads multisig PDAs.
 * The collateral owner is a Squads vault PDA (derived from multisig), which requires:
 * - Deriving the multisig PDA deterministically from member key
 * - Deriving the vault PDA from the multisig PDA
 * - Creating a vault transaction with withdrawal instruction
 * - Creating a proposal in Squads
 * - Members voting to approve
 * - Executing the proposal with Ed25519 signature verification (Squads CPI into collateral program with PDA signature)
 * - Coordinator signature (embedded in transaction as top-level Ed25519 instruction)
 *
 * Environment Variables Required:
 * 
 * - RAIN_API_KEY: Your Rain API key for authentication
 *   Example: RAIN_API_KEY=your_api_key_here
 * 
 * - SOLANA_RPC_URL: Solana RPC endpoint URL
 *   Example: SOLANA_RPC_URL=https://api.devnet.solana.com
 * 
 * - MEMBER_PK: Base58-encoded private key for the single multisig member (threshold = 1)
 *   Example: MEMBER_PK=your_base58_encoded_private_key
 *   Note: The multisig PDA is derived deterministically from this member's public key
 *
 * - PAYER_PK: Fee payer for transactions
 *   Example: PAYER_PK=your_base58_encoded_private_key
 * 
 * - RAIN_API_URL: (Optional) Rain API base URL. Defaults to https://api-dev.raincards.xyz
 *   Example: RAIN_API_URL=https://api-dev.raincards.xyz
 * 
 * Environment Setup:
 * 1. Create .env.local file in project root
 * 2. Add the above environment variables
 * 3. Ensure .env.local is in .gitignore
 * 4. Install Squads SDK: npm install @sqds/multisig
 * 
 * API Documentation:
 * 
 * Endpoints Used:
 * 
 * 1. GET /v1/issuing/users/{userId}/signatures/withdrawals
 *    Purpose: Retrieve V2.2 signature for single-signer withdrawal
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Query Params: token, amount, adminAddress (vault PDA address), recipientAddress, chainId
 *    Note: The adminAddress parameter should be the vault PDA address (derived from multisig)
 *    Response: { status, parameters[] }
 * 
 * 2. GET /v1/issuing/users/{userId}/contracts
 *    Purpose: Get user's contracts for the specified network
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Response: Contract[] with proxyAddress, programAddress, depositAddress
 * 
 * Command Line Usage:
 * node dist/examples/cpi_withdrawal_v2_2/index.js userId token amount adminAddress recipientAddress chainId
 * 
 * Arguments:
 * - userId: The unique identifier for the user requesting the withdrawal
 * - token: The token mint address (as a string) for the SPL token being withdrawn (or PublicKey.default for SOL)
 * - amount: The amount of tokens to withdraw (as a string, usually in the smallest unit)
 * - adminAddress: The vault PDA address (derived from multisig) - should match the collateral owner
 * - recipientAddress: The user's personal Solana public key (as a string) where funds will be sent
 * - chainId: The identifier for the Solana chain/network (e.g., "901" for devnet, "900" for mainnet)
 *
 * Flow:
 * 1. Derive multisig PDA deterministically from member's public key (or use existing)
 * 2. Derive vault PDA from multisig PDA (index 0)
 * 3. Fetch withdrawal signature from Rain API (using vault PDA as adminAddress)
 * 4. Build Ed25519 signature verification instruction (top-level)
 * 5. Build withdrawal instruction (for Squads vault transaction)
 * 6. Create Squads vault transaction with withdrawal instruction
 * 7. Create proposal for the vault transaction
 * 8. Approve proposal (threshold = 1)
 * 9. Execute final transaction: Ed25519 verification + Squads vaultTransactionExecute (CPI)
 */

import axios from "axios";
import dotenv from "dotenv";
import crypto from 'crypto-js';
import * as multisig from "@sqds/multisig";

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  Account
} from "@solana/spl-token";

import MainIdl from "./idl/main.json";
import { Main } from "./idl/main";
import { Ed25519ExtendedProgram } from "../../utils/ed25519.program";
import path from "path";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

const DEFAULT_BASE_URL = "https://api-dev.raincards.xyz";

type FetchV2_1SignatureOpts = {
  userId: string;
  token: string;
  amount: string;
  adminAddress: string;
  recipientAddress: string;
  chainId: string;
};

class HashUtils {
  static keccak256Hex(data: string): string {
    const wordArray = crypto.enc.Hex.parse(data);
    const hash = crypto.SHA3(wordArray, { outputLength: 256 });
    return hash.toString();
  }

  static keccak256(data: string): string {
    const hash = crypto.SHA3(data, { outputLength: 256 });
    return hash.toString();
  }

  static encodeString(value: string): string {
    return HashUtils.keccak256(value);
  }

  static encodeAddress(value: PublicKey): string {
    return value.toBuffer().toString('hex');
  }

  static encodeUInt32(value: bigint | number): string {
    return value.toString(16).padStart(8, '0');
  }

  static encodeUInt64(value: bigint): string {
    return value.toString(16).padStart(16, '0');
  }

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
    const encodedStructure = [
      DomainSeparatorMessage.DOMAIN_TYPE_HASH,
      HashUtils.encodeString(name),
      HashUtils.encodeString(version),
      HashUtils.encodeUInt64(chainId),
      HashUtils.encodeAddress(verifyingContract),
      HashUtils.encodeBytes(salt),
    ].join('');
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
   * @param owner - The owner address (vault PDA for Squads multisig)
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
    return HashUtils.keccak256Hex(encodedStructure);
  }

  /**
   * Gets the SingleSignerCollateral withdrawal message for coordinator signature
   * @param coordinator - The coordinator public key
   * @param collateral - The SingleSignerCollateral account
   * @param owner - The owner of the collateral (vault PDA for Squads multisig)
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
 * @param connection - The Solana connection instance
 * @param payer - The payer keypair (for creating account if needed)
 * @param recipientAddress - The address of the recipient
 * @param mintAddress - The mint address of the token being withdrawn
 * @returns The associated token account for the recipient
 */
async function getDestinationTokenAccount(
  connection: Connection,
  payer: Keypair,
  recipientAddress: PublicKey,
  mintAddress: PublicKey,
): Promise<Account> {
  return await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
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
 * @param depositAddress - The deposit address of the collateral (authority)
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
 * Builds the withdrawal instruction and Ed25519 verification instruction separately
 * The Ed25519 instruction will be executed as a top-level instruction, while the withdrawal
 * instruction will be stored in the Squads vault transaction and executed via CPI.
 * 
 * @param program - The Anchor program instance
 * @param collateral - The collateral public key
 * @param depositAddress - The deposit/authority address of the collateral
 * @param vaultPda - The Squads vault PDA (actual owner/signer of the collateral)
 * @param recipientAddress - The recipient's public key
 * @param mintAddress - The token mint public key (or PublicKey.default for SOL)
 * @param expiration - The expiration timestamp for the signature
 * @param amountInCents - The withdrawal amount
 * @param signatureSalt - The salt used to generate the coordinator signature
 * @param signatureData - The coordinator signature data
 * @param payer - The payer keypair (for creating token accounts if needed)
 * @returns Object with ed25519Instruction, withdrawalInstruction, and coordinatorExecutor
 */
async function buildWithdrawalInstructions(
  program: Program<Main>,
  collateral: PublicKey,
  depositAddress: PublicKey,
  vaultPda: PublicKey,
  recipientAddress: PublicKey,
  mintAddress: PublicKey,
  expiration: number,
  amountInCents: number,
  signatureSalt: Buffer,
  signatureData: Buffer,
  payer: Keypair,
): Promise<{
  ed25519Instruction: TransactionInstruction;
  withdrawalInstruction: TransactionInstruction;
  coordinatorExecutor: PublicKey;
}> {
  const coordinatorMessageSalt: number[] = Array.from(signatureSalt).map(Number)
  const coordinatorSignature: number[] = Array.from(signatureData).map(Number)
  const expiresAt = new BN(expiration)
  const amountOfAsset = new BN(amountInCents)

  const withdrawRequest: WithdrawSingleSignerCollateralAssetRequest = {
    amountInAsset: amountOfAsset,
    signatureExpirationTime: expiresAt,
    coordinatorSignatureSalt: coordinatorMessageSalt,
  };

  // Fetch the collateral account
  const collateralAccount = await program.account.singleSignerCollateral.fetch(collateral)
  console.log("Collateral owner:", collateralAccount.owner.toBase58())
  console.log("Vault PDA (expected owner):", vaultPda.toBase58())
  console.log("Collateral nonce:", collateralAccount.nonce)

  // Verify owner is the vault PDA
  if (!collateralAccount.owner.equals(vaultPda)) {
    throw new Error(`Owner mismatch. Expected vault PDA: ${vaultPda.toBase58()}, Got: ${collateralAccount.owner.toBase58()}`);
  }

  // Get token accounts (null for SOL withdrawals)
  let collateralTokenAccount: PublicKey | null = null;
  let destinationTokenAccount: Account | null = null;

  if (!mintAddress.equals(PublicKey.default)) {
    // SPL token withdrawal
    collateralTokenAccount = await getSourceTokenAccount(depositAddress, mintAddress)
    console.log("Source token account", collateralTokenAccount.toBase58())

    destinationTokenAccount = await getDestinationTokenAccount(
      program.provider.connection,
      payer,
      recipientAddress,
      mintAddress,
    );
    console.log("Destination token account", destinationTokenAccount.address.toBase58())
  } else {
    console.log("Withdrawing native SOL")
  }

  // Fetch coordinator to get executor for signature verification
  const coordinator: any = await program.account.coordinator.fetch(collateralAccount.coordinator)
  if (!coordinator.executors || coordinator.executors.length === 0) {
    throw new Error('No executors found in the given coordinator')
  }

  const coordinatorExecutor = coordinator.executors.find((e: PublicKey) => e)!;
  console.log("Coordinator executor:", coordinatorExecutor.toBase58())

  // 1. Build Ed25519 signature verification instruction (will be top-level)
  const ed25519Instruction = Ed25519ExtendedProgram.createSignatureVerificationInstruction([
    {
      signer: coordinatorExecutor,
      signature: Buffer.from(coordinatorSignature),
      message: Coordinator.getWithdrawSingleSignerMessage(
        collateralAccount.coordinator,
        collateral,
        vaultPda, // Owner is the vault PDA
        recipientAddress,
        mintAddress,
        collateralAccount.nonce,
        withdrawRequest,
      )
    }
  ]);

  // 2. Build withdrawal instruction (will be stored in Squads vault)
  const withdrawalInstruction = await program.methods.withdrawSingleSignerCollateralAsset(withdrawRequest)
    .accounts({
      owner: vaultPda, // Squads vault PDA will sign via CPI
      coordinator: collateralAccount.coordinator,
      collateral: collateral,
      destination: recipientAddress,
      asset: mintAddress.equals(PublicKey.default) ? null : mintAddress,
      collateralTokenAccount: collateralTokenAccount,
      destinationTokenAccount: destinationTokenAccount ? destinationTokenAccount.address : null,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return {
    ed25519Instruction,
    withdrawalInstruction,
    coordinatorExecutor,
  };
}

/**
 * Creates a Squads v4 multisig if it doesn't exist
 * Uses the member's public key as seed for deterministic PDA derivation.
 * The multisig PDA is derived deterministically, so the same member key will
 * always produce the same multisig PDA.
 * 
 * @param connection - The Solana connection instance
 * @param member - The multisig member keypair (used as seed for deterministic PDA)
 * @param payer - The payer keypair (for transaction fees)
 * @returns The multisig PDA address
 */
async function getOrCreateSquadsMultisig(
  connection: Connection,
  member: Keypair,
  payer: Keypair
): Promise<PublicKey> {
  console.log("\n=== GETTING OR CREATING SQUADS MULTISIG ===\n");

  // Derive deterministic multisig PDA using member's public key as seed
  const createKey = Keypair.fromSeed(member.publicKey.toBuffer().slice(0, 32));
  
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });

  console.log("Derived Multisig PDA:", multisigPda.toBase58());
  console.log("Create Key:", createKey.publicKey.toBase58());

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

  // Multisig doesn't exist, create it
  console.log("✗ Multisig not found, creating new one...\n");

  // Get program config for treasury
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  
  console.log("Fetching program config...");
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda
  );

  const configTreasury = programConfig.treasury;
  console.log("✓ Program config treasury:", configTreasury.toBase58());

  // Create the multisig
  console.log("\nCreating multisig with:");
  console.log(`  Member: ${member.publicKey.toBase58()}`);
  console.log(`  Threshold: 1 (single signature)`);
  console.log(`  Permissions: All`);

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
  console.log(`  Transaction: ${signature}`);
  console.log(`  Multisig PDA: ${multisigPda.toBase58()}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet\n`);

  return multisigPda;
}

const main = async ({
  userId,
  token,
  amount,
  adminAddress,
  recipientAddress,
  chainId,
}: FetchV2_1SignatureOpts) => {
  // Setup connection
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("No RPC URL provided");
  }
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });

  // Load member keypair (single member, threshold = 1)
  const memberPk = process.env.MEMBER_PK;
  if (!memberPk) {
    throw new Error("MEMBER_PK environment variable required");
  }
  const member = Keypair.fromSecretKey(bs58.decode(memberPk) as Uint8Array);

  // Load payer
  const payerPk = process.env.PAYER_PK;
  if (!payerPk) {
    throw new Error("PAYER_PK environment variable required");
  }
  const payer = Keypair.fromSecretKey(bs58.decode(payerPk) as Uint8Array);

  console.log("Member:", member.publicKey.toBase58());
  console.log("Payer:", payer.publicKey.toBase58());

  // Get or create Squads multisig (deterministic based on member key)
  const multisigPdaKey = await getOrCreateSquadsMultisig(connection, member, payer);
  
  console.log("\n=== USING MULTISIG ===");
  console.log("Multisig PDA:", multisigPdaKey.toBase58());

const baseUrl = process.env.RAIN_API_URL || DEFAULT_BASE_URL;

  // Fetch signature from Rain API
  const signatureUrl = `${baseUrl}/v1/issuing/users/${userId}/signatures/withdrawals`;
  const params = {
    token,
    amount,
    adminAddress,
    recipientAddress,
    chainId,
  };

  const signatureResponse = await axios.get(signatureUrl, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
    params,
  });

  const { data: signature } = await signatureResponse;
  if (!signature || signature.status === "failed") {
    throw new Error("Signature generation failed");
  }

  if (!signature.parameters || !Array.isArray(signature.parameters)) {
    throw new Error("Invalid signature response");
  }

  const collateralProxy = signature.parameters[0];
  const assetAddress = signature.parameters[1];
  const amountInCents = signature.parameters[2];
  const recipient = signature.parameters[3];
  const expiresAt = signature.parameters[4];
  const executorPublisherSalt = Buffer.from(signature.parameters[5], "base64");
  const executorPublisherSig = Buffer.from(signature.parameters[6], "base64");

  // Fetch contract details
  const contractsUrl = `${baseUrl}/v1/issuing/users/${userId}/contracts`;
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

  console.log("\nContract found:", contract.proxyAddress);
  console.log("Program:", contract.programAddress);
  console.log("Deposit:", contract.depositAddress);

  // Load Rain program
  const idl: any = Object.assign(MainIdl, { address: contract.programAddress });
  const program = new Program<Main>(
    idl, new AnchorProvider(connection, new Wallet(payer), AnchorProvider.defaultOptions()));

  // Derive the vault PDA (this will be the actual owner/signer)
  const [vaultPda] = multisig.getVaultPda({
    multisigPda: multisigPdaKey,
    index: 0,
  });

  console.log("\n=== DERIVED VAULT PDA ===");
  console.log("Multisig PDA:", multisigPdaKey.toBase58());
  console.log("Vault PDA (index 0):", vaultPda.toBase58());
  console.log("(The collateral owner should be the vault PDA, not the multisig PDA)");

  // Build withdrawal instructions (separate Ed25519 from withdrawal)
  console.log("\nBuilding withdrawal instructions...");
  const { ed25519Instruction, withdrawalInstruction, coordinatorExecutor } = await buildWithdrawalInstructions(
    program,
    new PublicKey(collateralProxy),
    new PublicKey(contract.depositAddress),
    vaultPda, // Use vault PDA as owner, not multisig PDA
    new PublicKey(recipient),
    new PublicKey(assetAddress),
    expiresAt,
    amountInCents,
    executorPublisherSalt,
    executorPublisherSig,
    payer
  );

  console.log("\n=== SQUADS MULTISIG WORKFLOW (Ed25519 + Vault Execution) ===\n");

  // Get the current multisig transaction index
  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection as any,
    multisigPdaKey
  );

  const currentTransactionIndex = Number(multisigInfo.transactionIndex);
  const newTransactionIndex = BigInt(currentTransactionIndex + 1);

  // STEP 1: Create vault transaction with ONLY the withdrawal instruction (no Ed25519)
  console.log("Step 1: Creating vault transaction (withdrawal only, no Ed25519)...");
  
  const vaultMessage = new TransactionMessage({
    payerKey: vaultPda, // Vault PDA pays for the withdrawal
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [withdrawalInstruction], // ONLY withdrawal, Ed25519 will be top-level later
  });

  const signature1 = await multisig.rpc.vaultTransactionCreate({
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
  
  await connection.confirmTransaction(signature1);
  console.log("✓ Vault transaction created (withdrawal instruction stored)");
  console.log("  Transaction:", signature1);

  // STEP 2: Create proposal
  console.log("\nStep 2: Creating proposal...");
  
  const signature2 = await multisig.rpc.proposalCreate({
    connection: connection as any,
    feePayer: payer,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    creator: member,
    isDraft: false,
  });
  
  await connection.confirmTransaction(signature2);
  console.log("✓ Proposal created");
  console.log("  Transaction:", signature2);

  // STEP 3: Approve proposal
  console.log("\nStep 3: Approving proposal (threshold = 1)...");
  
  const signature3 = await multisig.rpc.proposalApprove({
    connection: connection as any,
    feePayer: payer,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    member: member,
  });
  
  await connection.confirmTransaction(signature3);
  console.log("✓ Proposal approved");
  console.log("  Transaction:", signature3);

  // STEP 4: Execute with Ed25519 verification BEFORE Squads execution
  console.log("\nStep 4: Building final transaction with Ed25519 + vaultTransactionExecute...");
  console.log("  Instruction 0: Ed25519 signature verification (top-level)");
  console.log("  Instruction 1: Squads vaultTransactionExecute (CPI to withdrawal)");
  console.log("  (When withdrawal executes at ix 1, it looks back to ix 0 and finds Ed25519)");
  
  // Get the vault transaction PDA
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda: multisigPdaKey,
    index: newTransactionIndex,
  });
  
  // Build the vaultTransactionExecute instruction using Squads SDK
  const vaultTransactionExecuteResult = await multisig.instructions.vaultTransactionExecute({
    connection: connection as any,
    multisigPda: multisigPdaKey,
    transactionIndex: newTransactionIndex,
    member: member.publicKey,
    programId: multisig.PROGRAM_ID,
  });

  // Build final transaction: Ed25519 THEN Squads execute
  const finalTransaction = new Transaction();
  finalTransaction.add(ed25519Instruction); // Instruction 0: Ed25519 verification
  finalTransaction.add(vaultTransactionExecuteResult.instruction); // Instruction 1: Execute vault transaction
  
  const signature4 = await sendAndConfirmTransaction(
    connection,
    finalTransaction,
    [payer, member], // Payer and member sign
    { commitment: 'confirmed' }
  );
  
  console.log("✓ Transaction executed successfully!");
  console.log("  Transaction:", signature4);

  console.log("\n=== WITHDRAWAL COMPLETED ===");
  console.log("Transaction executed via Squads multisig CPI");
  console.log("Recipient:", recipient);
  console.log("Amount:", amountInCents);
};

// Command line arguments
const userId = process.argv[2];
const token = process.argv[3];
const amount = process.argv[4];
const adminAddress = process.argv[5];
const recipientAddress = process.argv[6];
const chainId = process.argv[7];

// Validate environment variables
const apiKey = process.env.RAIN_API_KEY;
if (!apiKey) {
  throw new Error("RAIN_API_KEY environment variable is required");
}

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) {
  throw new Error("SOLANA_RPC_URL environment variable is required");
}

if (!userId || !token || !amount || !adminAddress || !recipientAddress || !chainId) {
  throw new Error("Required command line arguments not provided");
}

main({ userId, token, amount, adminAddress, recipientAddress, chainId }).catch((ex) =>
  console.error(ex)
);
