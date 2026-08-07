/**
 * This script demonstrates the timelock (permissionless) withdrawal flow introduced by the
 * v2.05 collateral program for single-signer collateral accounts. Unlike the
 * signature-based withdrawal (see single_signer_program_v2_02), no Rain-issued signature
 * is required: the collateral owner requests the withdrawal fully on-chain, Rain reviews
 * the request and either executes it early (expedited) or cancels it, and if Rain does
 * not act the owner can execute it once the 7-day timelock elapses.
 *
 * Actions:
 *
 * - request: Create the on-chain withdrawal request with
 *   `request_single_signer_permissionless_withdrawal`. A single transaction signed by
 *   the collateral owner; no admin signatures and no Ed25519 verification involved.
 *
 * - process: Execute a pending request with `process_permissionless_withdrawal`. Callable
 *   by the owner once the timelock has elapsed (Rain executors can process at any time,
 *   without waiting).
 *
 * - cancel: Close a pending request with `cancel_permissionless_withdrawal`, reclaiming
 *   the request account rent. The owner cancels without a reason; only Rain executors
 *   may attach a cancellation reason.
 *
 * - list: Read your tenant's timelock withdrawal requests from the Rain API.
 *
 * Environment Variables Required:
 *
 * - RAIN_API_KEY: Your Rain API key for authentication
 * - RAIN_API_URL: Rain API base URL (defaults to https://api-dev.raincards.xyz)
 * - SOLANA_RPC_URL: Solana RPC endpoint URL
 * - OWNER_PK: Base58-encoded private key of the collateral owner
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
 * node dist/src/solana/examples/withdrawal/single_signer_timelock_program_v2_05/index.js <action> [args]
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
import { IdlV2_05, MainV2_05 } from "@rain/program";
import path from "path";

// Load environment-specific configuration
const nodeEnv = process.env.NODE_ENV || 'local';
dotenv.config({ path: path.join(__dirname, `.env.${nodeEnv}`) });

const BASE_URL = process.env.RAIN_API_URL || "https://api-dev.raincards.xyz";

const WITHDRAWAL_REQUEST_SEED = Buffer.from('WithdrawalRequest', 'utf-8');
const TIMELOCK_CONFIG_SEED = Buffer.from('TimelockConfig', 'utf-8');
const COLLATERAL_AUTHORITY_SEED = Buffer.from('CollateralAuthority', 'utf-8');

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
 * Fetches the single-signer collateral account and verifies the owner key
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param owner - The expected owner keypair
 * @returns The single-signer collateral account state
 */
async function getOwnedCollateral(program: Program<MainV2_05>, collateral: PublicKey, owner: Keypair) {
  const collateralAccount = await program.account.singleSignerCollateral.fetch(collateral);
  if (!collateralAccount.owner.equals(owner.publicKey)) {
    throw new Error(`Owner mismatch. Expected: ${collateralAccount.owner.toBase58()}, Got: ${owner.publicKey.toBase58()}`);
  }
  return collateralAccount;
}

/**
 * Requests a permissionless withdrawal with a single transaction signed by the owner,
 * creating the on-chain WithdrawalRequest account.
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param owner - The collateral owner keypair
 * @param amount - The amount to withdraw in the asset's base units
 * @param recipient - The account that will receive the funds
 * @param assetMint - The asset mint (PublicKey.default for native SOL)
 */
async function requestWithdrawal(
  program: Program<MainV2_05>,
  collateral: PublicKey,
  owner: Keypair,
  amount: BN,
  recipient: PublicKey,
  assetMint: PublicKey,
) {
  const collateralAccount = await getOwnedCollateral(program, collateral, owner);

  const isSol = assetMint.equals(PublicKey.default);
  const collateralAuthority = deriveCollateralAuthorityPDA(collateral, program.programId);
  const collateralTokenAccount = isSol ? null : getAssociatedTokenAddressSync(
    assetMint,
    collateralAuthority,
    true,
    await resolveMintTokenProgram(program.provider.connection, assetMint),
  );

  const transaction = await program.methods.requestSingleSignerPermissionlessWithdrawal(amount, recipient, assetMint)
    .accountsPartial({
      owner: owner.publicKey,
      rentPayer: owner.publicKey,
      coordinator: collateralAccount.coordinator,
      collateral,
      collateralAuthority,
      // Must always be passed at the derived address, even when the account does not exist
      timelockConfig: deriveTimelockConfigPDA(collateralAccount.coordinator, program.programId),
      asset: isSol ? null : assetMint,
      collateralTokenAccount,
      withdrawalRequest: deriveWithdrawalRequestPDA(collateral, assetMint, program.programId),
    }).transaction();

  const transactionHash = await sendAndConfirmTransaction(
    program.provider.connection,
    transaction,
    [owner],
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
 * once the timelock has elapsed (current collateral owner); Rain executors can process
 * at any time. If ownership was transferred after the request, it becomes stale and can
 * only be cancelled.
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param owner - The collateral owner keypair sending the transaction
 * @param assetMint - The asset mint of the pending request (PublicKey.default for native SOL)
 */
async function processWithdrawal(
  program: Program<MainV2_05>,
  collateral: PublicKey,
  owner: Keypair,
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

  const collateralAccount = await getOwnedCollateral(program, collateral, owner);
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
      sender: owner.publicKey,
      coordinator: collateralAccount.coordinator,
      collateral,
      collateralAuthority,
      withdrawalRequest: withdrawalRequestAddress,
      rentCollector: request.rentCollector,
      rentPayer: owner.publicKey,
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
    [owner],
    { commitment: 'confirmed' }
  );

  console.log("Withdrawal executed");
  console.log("Transaction", transactionHash);
  console.log("Amount:", request.amount.toString());
  console.log("Recipient:", request.recipient.toBase58());
}

/**
 * Cancels a pending withdrawal request with cancel_permissionless_withdrawal, closing
 * the request account and returning its rent. The owner must cancel without a reason;
 * cancellation reasons are reserved for Rain executors (see the list action's
 * cancellationReason field).
 *
 * @param program - The Anchor program instance
 * @param collateral - The collateral account address
 * @param owner - The collateral owner keypair sending the transaction
 * @param assetMint - The asset mint of the pending request (PublicKey.default for native SOL)
 */
async function cancelWithdrawal(
  program: Program<MainV2_05>,
  collateral: PublicKey,
  owner: Keypair,
  assetMint: PublicKey,
) {
  const withdrawalRequestAddress = deriveWithdrawalRequestPDA(collateral, assetMint, program.programId);
  const request = await program.account.withdrawalRequest.fetchNullable(withdrawalRequestAddress);
  if (!request) {
    throw new Error("No pending withdrawal request for this collateral + asset");
  }

  const collateralAccount = await getOwnedCollateral(program, collateral, owner);

  const transaction = await program.methods.cancelPermissionlessWithdrawal(null)
    .accountsPartial({
      sender: owner.publicKey,
      coordinator: collateralAccount.coordinator,
      collateral,
      withdrawalRequest: withdrawalRequestAddress,
      rentCollector: request.rentCollector,
    }).transaction();

  const transactionHash = await sendAndConfirmTransaction(
    program.provider.connection,
    transaction,
    [owner],
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
  const owner = Keypair.fromSecretKey(bs58.decode(requireEnv("OWNER_PK")) as any);

  const [userId, collateralAddress] = args;
  const contract = await getContract(userId, collateralAddress);
  const program = getProgram(contract.programAddress, owner);
  const collateral = new PublicKey(collateralAddress);

  if (action === 'request') {
    const [, , amount, recipientAddress, assetMint] = args;
    return requestWithdrawal(program, collateral, owner, new BN(amount), new PublicKey(recipientAddress), parseAssetMint(assetMint));
  }
  const assetMint = parseAssetMint(args[2]);
  return action === 'process'
    ? processWithdrawal(program, collateral, owner, assetMint)
    : cancelWithdrawal(program, collateral, owner, assetMint);
};

main().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
