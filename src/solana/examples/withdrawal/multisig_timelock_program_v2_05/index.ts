/**
 * This script demonstrates the timelock (permissionless) withdrawal flow introduced by the
 * v2.05 collateral program for multisig collateral accounts. Unlike the signature-based
 * withdrawal (see multisig_program_v2_01), no Rain-issued signature is required: the
 * collateral admins request the withdrawal fully on-chain, Rain reviews the request and
 * either executes it early (expedited) or cancels it, and if Rain does not act the admins
 * can execute it themselves once the 7-day timelock elapses.
 *
 * Actions:
 *
 * - request: Submit the admin signature(s) and create the on-chain withdrawal request.
 *   The request is a 2-transaction flow: an Ed25519-verified `submit_signatures` call with
 *   the `RequestPermissionlessWithdrawal` type, then `request_permissionless_withdrawal`.
 *   With an admin threshold above 1, each admin re-runs the same command to add their
 *   signature; the run that reaches the threshold sends the request transaction.
 *
 * - process: Execute a pending request with `process_permissionless_withdrawal`. Callable
 *   by any current collateral admin once the timelock has elapsed (Rain executors can
 *   process at any time, without waiting).
 *
 * - cancel: Close a pending request with `cancel_permissionless_withdrawal`, reclaiming
 *   the request account rent. Admins cancel without a reason; only Rain executors may
 *   attach a cancellation reason.
 *
 * - list: Read your tenant's timelock withdrawal requests from the Rain API.
 *
 * Environment Variables Required:
 *
 * - RAIN_API_KEY: Your Rain API key for authentication
 * - RAIN_API_URL: Rain API base URL (defaults to https://api-dev.raincards.xyz)
 * - SOLANA_RPC_URL: Solana RPC endpoint URL
 * - COLLATERAL_ADMIN_PK: Base58-encoded private key of a collateral admin
 *
 * Environment Setup:
 * 1. Create a .env.local file next to this script
 * 2. Add the above environment variables
 * 3. Ensure .env.local is in .gitignore
 *
 * API Endpoints Used:
 *
 * 1. GET /v1/issuing/users/{userId}/contracts
 *    Purpose: Resolve the collateral's program address from its proxy address
 *    Headers: Api-Key: {RAIN_API_KEY}
 *
 * 2. GET /v1/issuing/time-lock-withdrawals
 *    Purpose: List the tenant's timelock withdrawal requests and their statuses
 *    Headers: Api-Key: {RAIN_API_KEY}
 *    Query Params: cursor, limit, chainId, assetAddress, status (PENDING|EXECUTED|CANCELLED),
 *                  unlockAfter, unlockBefore
 *
 * Command Line Usage:
 * node dist/src/solana/examples/withdrawal/multisig_timelock_program_v2_05/index.js <action> [args]
 *
 *   request <userId> <collateralAddress> <amount> <recipientAddress> <assetMint|SOL>
 *   process <userId> <collateralAddress> <assetMint|SOL>
 *   cancel  <userId> <collateralAddress> <assetMint|SOL>
 *   list    [status] [chainId]
 *
 * Arguments:
 * - userId: The unique identifier of the user that owns the collateral
 * - collateralAddress: The collateral account (proxy) address
 * - amount: The amount to withdraw in the asset's base units (1 SOL = 1000000000, 1 USDC = 1000000)
 * - recipientAddress: The Solana public key that will receive the funds
 * - assetMint: The SPL token mint address, or the literal SOL for native SOL
 * - status: Optional list filter (PENDING, EXECUTED or CANCELLED)
 * - chainId: Optional list filter ("900" mainnet, "901" devnet)
 *
 * Flow & Expectations:
 * 1. request creates a WithdrawalRequest account and prints when it becomes executable
 *    (7 days). Only one request can exist per collateral + asset pair at a time.
 * 2. Rain is notified on-chain and reviews the request: it may execute it early or cancel
 *    it (with a reason, visible via the list action).
 * 3. If Rain does not act, run process after the timelock elapses to receive the funds.
 * 4. cancel closes a pending request at any time and returns the account rent.
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
  sendAndConfirmTransaction
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import { Ed25519ExtendedProgram, IdlV2_05, MainV2_05 } from "@rain/program";
import path from "path";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

const BASE_URL = process.env.RAIN_API_URL || "https://api-dev.raincards.xyz";

const WITHDRAWAL_REQUEST_SEED = Buffer.from('WithdrawalRequest', 'utf-8');
const TIMELOCK_CONFIG_SEED = Buffer.from('TimelockConfig', 'utf-8');
const COLLATERAL_AUTHORITY_SEED = Buffer.from('CollateralAuthority', 'utf-8');
const COLLATERAL_ADMIN_SIGNATURES_SEED = Buffer.from('CollateralAdminSignatures', 'utf-8');

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

/**
 * The RequestPermissionlessWithdrawal action message signed by the collateral admins.
 * The action message hash doubles as the id of the admin signatures account, so the
 * signatures PDA is derived from it.
 */
class RequestPermissionlessWithdrawalMessage {
  private static TYPE_HASH = HashUtils.encodeString('RequestPermissionlessWithdrawal(address collateral,address recipient,address asset,uint256 amount,uint256 nonce)');

  constructor(
    readonly collateral: PublicKey,
    readonly recipient: PublicKey,
    readonly asset: PublicKey,
    readonly amount: BN,
    readonly adminFundsNonce: number,
  ) {}

  /**
   * Encodes the action message and returns its hash
   * @returns The action message hash as a hex string
   */
  encode(): string {
    const encodedStructure = [
      RequestPermissionlessWithdrawalMessage.TYPE_HASH,
      HashUtils.encodeAddress(this.collateral),
      HashUtils.encodeAddress(this.recipient),
      HashUtils.encodeAddress(this.asset),
      HashUtils.encodeUInt64(BigInt(this.amount.toString())),
      HashUtils.encodeUInt32(this.adminFundsNonce),
    ].join('');
    return HashUtils.keccak256Hex(encodedStructure);
  }

  /**
   * Gets the 32-byte message an admin signs with their Ed25519 key
   * @param salt - The unique salt for this admin's signature
   * @returns The message to sign as a buffer
   */
  getSignedMessage(salt: number[]): Buffer {
    const encodedData = [
      PaddingBytesMessage.encode(),
      DomainSeparatorMessage.encode(
        'Collateral',
        '2',
        900n,
        this.collateral,
        new Uint8Array(salt),
      ),
      this.encode(),
    ].join('');
    return Buffer.from(HashUtils.keccak256Hex(encodedData), 'hex');
  }

  /**
   * Derives the admin signatures account for this action
   * @param programId - The Main program ID
   * @returns The signatures account address
   */
  getSignaturesPDA(programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        COLLATERAL_ADMIN_SIGNATURES_SEED,
        this.collateral.toBuffer(),
        Buffer.from(this.encode(), 'hex'),
      ],
      programId,
    );
    return pda;
  }
}

/**
 * Derives the withdrawal request account for a collateral + asset pair.
 * Only one request can exist per pair at a time; the same address recurs
 * for the next request once the previous one is closed.
 */
function deriveWithdrawalRequestPDA(collateral: PublicKey, assetMint: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [WITHDRAWAL_REQUEST_SEED, collateral.toBuffer(), assetMint.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * Derives the coordinator's timelock config account. Timelock withdrawals are opt-in
 * per coordinator: when this account does not exist on-chain the feature is disabled
 * and requests fail with TimelockNotEnabled. The account must still always be passed
 * at this address so a missing/forged account cannot bypass enabled = false.
 */
function deriveTimelockConfigPDA(coordinator: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [TIMELOCK_CONFIG_SEED, coordinator.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * Derives the collateral authority (vault) account that holds the collateral funds
 */
function deriveCollateralAuthorityPDA(collateral: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [COLLATERAL_AUTHORITY_SEED, collateral.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * Parses the asset mint CLI argument; the literal SOL means native SOL, which the
 * program represents as the default (all-zeros) public key
 */
function parseAssetMint(value: string): PublicKey {
  return value.toUpperCase() === 'SOL' ? PublicKey.default : new PublicKey(value);
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
 * Creates a Program instance for interacting with the on-chain program
 *
 * @param programAddress - The address of the on-chain program
 * @param signer - The keypair of the signer
 * @returns A Program instance for interacting with the on-chain program
 */
function getProgram(programAddress: string, signer: Keypair): Program<MainV2_05> {
  const rpcUrl = process.env.SOLANA_RPC_URL
  if (!rpcUrl) {
    throw new Error("No RPC URL provided");
  }

  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })

  // Load the program's Interface Description Language (IDL) which defines
  // the program's account structures and instruction interfaces
  const idl: any = Object.assign(IdlV2_05, { address: programAddress })

  const opts = AnchorProvider.defaultOptions()
  const provider = new AnchorProvider(
    connection,
    new Wallet(signer),
    opts
  )

  return new Program<MainV2_05>(idl, provider)
}

/**
 * Resolves the user's contract entry (program address, proxy address) from the Rain API
 *
 * @param userId - The user that owns the collateral
 * @param collateralAddress - The collateral account (proxy) address to match
 * @returns The contract entry from the API
 */
async function getContract(userId: string, collateralAddress: string) {
  const contractsUrl = `${BASE_URL}/v1/issuing/users/${userId}/contracts`;
  const contractsResponse = await axios.get(contractsUrl, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
  });

  const contract = contractsResponse.data.find((c: any) => c.proxyAddress === collateralAddress);
  if (!contract) {
    throw new Error(`Contract not found for collateral ${collateralAddress}`);
  }
  return contract;
}

/**
 * Submits this admin's signature for the RequestPermissionlessWithdrawal action to the
 * on-chain signatures account (skipped when the admin has already signed). Signatures
 * accumulate across transactions until the admin threshold is reached.
 *
 * @param program - The Anchor program instance
 * @param message - The action message to sign
 * @param admin - The collateral admin keypair signing and paying for the transaction
 * @returns The signatures account state after submission
 */
async function submitRequestSignature(
  program: Program<MainV2_05>,
  message: RequestPermissionlessWithdrawalMessage,
  admin: Keypair,
) {
  const signaturesPDA = message.getSignaturesPDA(program.programId);

  let signaturesAccount = await program.account.collateralAdminSignaturesV2.fetchNullable(signaturesPDA);
  if (signaturesAccount && signaturesAccount.signers.some(signer => signer.equals(admin.publicKey))) {
    console.log("Admin has already signed this request");
    return { signaturesPDA, signaturesAccount };
  }

  const salt: number[] = Array.from(randomBytes(32)).map(Number);
  const signedMessage = message.getSignedMessage(salt);
  const signature = nacl.sign.detached(Uint8Array.from(signedMessage), admin.secretKey);

  // The Ed25519 verification instruction must immediately precede submitSignatures
  // in the same transaction; the program reads it back through the instructions sysvar
  const signatureVerificationInstruction = Ed25519ExtendedProgram.createSignatureVerificationInstruction([{
    signer: admin.publicKey,
    signature: Buffer.from(signature),
    message: signedMessage,
  }]);

  const transaction = await program.methods.submitSignatures({
    salts: [salt],
    targetNonce: message.adminFundsNonce,
    signatureSubmissionType: {
      requestPermissionlessWithdrawal: {
        recipient: message.recipient,
        asset: message.asset,
        amount: message.amount,
      }
    },
  }).accounts({
    collateral: message.collateral,
    collateralAdminSignatures: signaturesPDA,
    rentPayer: admin.publicKey,
  }).preInstructions([
    signatureVerificationInstruction
  ]).transaction();

  const submitSignaturesHash = await sendAndConfirmTransaction(
    program.provider.connection,
    transaction,
    [admin],
    { commitment: 'confirmed' }
  );

  console.log("Admin signature submitted");
  console.log(submitSignaturesHash);

  signaturesAccount = await program.account.collateralAdminSignaturesV2.fetch(signaturesPDA);
  return { signaturesPDA, signaturesAccount };
}

/**
 * Requests a permissionless withdrawal: submits this admin's signature and, once the
 * admin threshold is reached, sends the request_permissionless_withdrawal transaction
 * that creates the on-chain WithdrawalRequest account.
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param admin - The collateral admin keypair
 * @param amount - The amount to withdraw in the asset's base units
 * @param recipient - The account that will receive the funds
 * @param assetMint - The asset mint (PublicKey.default for native SOL)
 */
async function requestWithdrawal(
  program: Program<MainV2_05>,
  collateral: PublicKey,
  admin: Keypair,
  amount: BN,
  recipient: PublicKey,
  assetMint: PublicKey,
) {
  const collateralAccount = await program.account.collateralV2.fetch(collateral);
  const threshold = Math.min(collateralAccount.adminThreshold, collateralAccount.admins.length);
  console.log("Collateral admin funds nonce:", collateralAccount.adminFundsNonce);
  console.log("Required signatures:", threshold);

  const message = new RequestPermissionlessWithdrawalMessage(
    collateral,
    recipient,
    assetMint,
    amount,
    collateralAccount.adminFundsNonce,
  );

  const { signaturesPDA, signaturesAccount } = await submitRequestSignature(program, message, admin);

  if (signaturesAccount.signers.length < threshold) {
    console.log(`${signaturesAccount.signers.length}/${threshold} signatures collected.`);
    console.log("Re-run this exact command as each remaining admin; the run that reaches the threshold sends the request.");
    return;
  }

  // The program constrains the request's rent payer to the account that paid the
  // signatures account rent, so only that admin can send the request transaction
  if (!signaturesAccount.rentPayer.equals(admin.publicKey)) {
    console.log(`${signaturesAccount.signers.length}/${threshold} signatures collected.`);
    console.log(`The request transaction must be sent by the admin that submitted the first signature: ${signaturesAccount.rentPayer.toBase58()}`);
    return;
  }

  const isSol = assetMint.equals(PublicKey.default);
  const collateralAuthority = deriveCollateralAuthorityPDA(collateral, program.programId);
  const collateralTokenAccount = isSol ? null : getAssociatedTokenAddressSync(
    assetMint,
    collateralAuthority,
    true,
    await resolveMintTokenProgram(program.provider.connection, assetMint),
  );

  const transaction = await program.methods.requestPermissionlessWithdrawal(amount, recipient, assetMint)
    .accountsPartial({
      sender: admin.publicKey,
      rentPayer: admin.publicKey,
      coordinator: collateralAccount.coordinator,
      collateral,
      collateralAuthority,
      collateralAdminSignatures: signaturesPDA,
      // Must always be passed at the derived address, even when the account does not exist
      timelockConfig: deriveTimelockConfigPDA(collateralAccount.coordinator, program.programId),
      asset: isSol ? null : assetMint,
      collateralTokenAccount,
      withdrawalRequest: deriveWithdrawalRequestPDA(collateral, assetMint, program.programId),
    }).transaction();

  const transactionHash = await sendAndConfirmTransaction(
    program.provider.connection,
    transaction,
    [admin],
    { commitment: 'confirmed' }
  );

  console.log("Withdrawal requested");
  console.log("Transaction", transactionHash);

  const request = await program.account.withdrawalRequest.fetch(
    deriveWithdrawalRequestPDA(collateral, assetMint, program.programId)
  );
  console.log("Amount:", request.amount.toString());
  console.log("Recipient:", request.recipient.toBase58());
  console.log("Executable from:", new Date(request.executableFrom.toNumber() * 1000).toISOString());
  console.log("Rain now reviews the request: it may execute it early or cancel it. Track it with the list action.");
}

/**
 * Executes a pending withdrawal request with process_permissionless_withdrawal. Works
 * once the timelock has elapsed (any current collateral admin); Rain executors can
 * process at any time.
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param sender - The collateral admin keypair sending the transaction
 * @param assetMint - The asset mint of the pending request (PublicKey.default for native SOL)
 */
async function processWithdrawal(
  program: Program<MainV2_05>,
  collateral: PublicKey,
  sender: Keypair,
  assetMint: PublicKey,
) {
  const withdrawalRequestAddress = deriveWithdrawalRequestPDA(collateral, assetMint, program.programId);
  const request = await program.account.withdrawalRequest.fetchNullable(withdrawalRequestAddress);
  if (!request) {
    throw new Error("No pending withdrawal request for this collateral + asset");
  }

  const executableFrom = request.executableFrom.toNumber();
  if (Date.now() / 1000 < executableFrom) {
    console.warn(`Warning: the request is executable from ${new Date(executableFrom * 1000).toISOString()}; the transaction will fail until then`);
  }

  const collateralAccount = await program.account.collateralV2.fetch(collateral);
  const collateralAuthority = deriveCollateralAuthorityPDA(collateral, program.programId);
  const isSol = request.asset.equals(PublicKey.default);
  const tokenProgramId = isSol
    ? TOKEN_PROGRAM_ID
    : await resolveMintTokenProgram(program.provider.connection, request.asset);

  // The recipient token account is created by the program when missing (rent paid by
  // rentPayer), so it only needs to be derived here. The stored request amount is
  // passed as expected_amount: the program rejects the transaction with
  // WithdrawalAmountMismatch if the pending request no longer matches it (the request
  // PDA is reused, so a cancelled-and-recreated request could otherwise be executed
  // with terms the sender never reviewed)
  const transaction = await program.methods.processPermissionlessWithdrawal(request.amount)
    .accountsPartial({
      sender: sender.publicKey,
      coordinator: collateralAccount.coordinator,
      collateral,
      collateralAuthority,
      withdrawalRequest: withdrawalRequestAddress,
      rentCollector: request.rentCollector,
      rentPayer: sender.publicKey,
      recipient: request.recipient,
      asset: isSol ? null : request.asset,
      collateralTokenAccount: isSol ? null : getAssociatedTokenAddressSync(request.asset, collateralAuthority, true, tokenProgramId),
      recipientTokenAccount: isSol ? null : getAssociatedTokenAddressSync(request.asset, request.recipient, true, tokenProgramId),
      tokenProgram: tokenProgramId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    }).transaction();

  const transactionHash = await sendAndConfirmTransaction(
    program.provider.connection,
    transaction,
    [sender],
    { commitment: 'confirmed' }
  );

  console.log("Withdrawal executed");
  console.log("Transaction", transactionHash);
  console.log("Amount:", request.amount.toString());
  console.log("Recipient:", request.recipient.toBase58());
}

/**
 * Cancels a pending withdrawal request with cancel_permissionless_withdrawal, closing
 * the request account and returning its rent. Admins must cancel without a reason;
 * cancellation reasons are reserved for Rain executors (see the list action's
 * cancellationReason field).
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param sender - The collateral admin keypair sending the transaction
 * @param assetMint - The asset mint of the pending request (PublicKey.default for native SOL)
 */
async function cancelWithdrawal(
  program: Program<MainV2_05>,
  collateral: PublicKey,
  sender: Keypair,
  assetMint: PublicKey,
) {
  const withdrawalRequestAddress = deriveWithdrawalRequestPDA(collateral, assetMint, program.programId);
  const request = await program.account.withdrawalRequest.fetchNullable(withdrawalRequestAddress);
  if (!request) {
    throw new Error("No pending withdrawal request for this collateral + asset");
  }

  const collateralAccount = await program.account.collateralV2.fetch(collateral);

  const transaction = await program.methods.cancelPermissionlessWithdrawal(null)
    .accountsPartial({
      sender: sender.publicKey,
      coordinator: collateralAccount.coordinator,
      collateral,
      withdrawalRequest: withdrawalRequestAddress,
      rentCollector: request.rentCollector,
    }).transaction();

  const transactionHash = await sendAndConfirmTransaction(
    program.provider.connection,
    transaction,
    [sender],
    { commitment: 'confirmed' }
  );

  console.log("Withdrawal request cancelled, rent returned to", request.rentCollector.toBase58());
  console.log("Transaction", transactionHash);
}

/**
 * Lists the tenant's timelock withdrawal requests from the Rain API
 *
 * @param status - Optional status filter (PENDING, EXECUTED or CANCELLED)
 * @param chainId - Optional chain filter ("900" mainnet, "901" devnet)
 */
async function listWithdrawals(status?: string, chainId?: string) {
  const { data } = await axios.get(`${BASE_URL}/v1/issuing/time-lock-withdrawals`, {
    headers: {
      "Api-Key": process.env.RAIN_API_KEY,
    },
    params: {
      limit: 100,
      ...(status && { status }),
      ...(chainId && { chainId }),
    },
  });

  if (!data.length) {
    console.log("No timelock withdrawals found");
    return;
  }

  console.table(data.map((w: any) => ({
    id: w.id,
    status: w.status,
    chainId: w.chainId,
    asset: w.assetAddress,
    amount: w.assetAmountNative,
    recipient: w.recipientAddress,
    requestedAt: w.requestedAt,
    isUnlocked: w.isUnlocked,
    unlockedAt: w.unlockedAt,
    cancellationReason: w.cancellationReason,
  })));
}

function printUsage(): never {
  console.error(`Usage: index.js <action> [args]

  request <userId> <collateralAddress> <amount> <recipientAddress> <assetMint|SOL>
  process <userId> <collateralAddress> <assetMint|SOL>
  cancel  <userId> <collateralAddress> <assetMint|SOL>
  list    [status] [chainId]

  amount is in the asset's base units (1 SOL = 1000000000, 1 USDC = 1000000)
  status is PENDING, EXECUTED or CANCELLED; chainId is "900" (mainnet) or "901" (devnet)`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

const main = async () => {
  const [action, ...args] = process.argv.slice(2);

  if (action === 'list') {
    const [status, chainId] = args;
    if (status && !['PENDING', 'EXECUTED', 'CANCELLED'].includes(status)) {
      printUsage();
    }
    requireEnv("RAIN_API_KEY");
    return listWithdrawals(status, chainId);
  }

  const expectedArgs = { request: 5, process: 3, cancel: 3 }[action];
  if (!expectedArgs || args.length !== expectedArgs) {
    printUsage();
  }

  requireEnv("RAIN_API_KEY");
  requireEnv("SOLANA_RPC_URL");
  const admin = Keypair.fromSecretKey(bs58.decode(requireEnv("COLLATERAL_ADMIN_PK")) as any);

  const [userId, collateralAddress] = args;
  const contract = await getContract(userId, collateralAddress);
  const program = getProgram(contract.programAddress, admin);
  const collateral = new PublicKey(collateralAddress);

  if (action === 'request') {
    const [, , amount, recipientAddress, assetMint] = args;
    return requestWithdrawal(program, collateral, admin, new BN(amount), new PublicKey(recipientAddress), parseAssetMint(assetMint));
  }
  const assetMint = parseAssetMint(args[2]);
  return action === 'process'
    ? processWithdrawal(program, collateral, admin, assetMint)
    : cancelWithdrawal(program, collateral, admin, assetMint);
};

main().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
