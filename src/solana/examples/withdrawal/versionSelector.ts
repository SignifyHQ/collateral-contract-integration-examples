/**
 * This script is a CLI tool that determines which withdrawal example (V1 or V2) to use
 * based on the version of your collateral account. It connects to a Solana RPC, fetches
 * the collateral account data, and reads the first 8 bytes (the account discriminator).
 * The discriminator is compared against the known V1 and V2 values from the collateral
 * program IDL; the script then tells you whether to follow the withdrawalV1 or
 * withdrawalV2 example.
 *
 * Environment Variables:
 * - None required. The script uses the public Solana RPC endpoints (Mainnet or Devnet)
 *   according to the network you select when prompted.
 *
 * Command Line Usage:
 * yarn run solana:withdraw:select-version
 *
 * Alternatively, from the project root:
 * npx ts-node src/solana/examples/withdrawal/versionSelector.ts
 *
 * Prompts:
 * 1. "Select the Solana network"
 *    - Mainnet — uses https://api.mainnet-beta.solana.com
 *    - Devnet  — uses https://api.devnet.solana.com
 *
 * 2. "Enter the Collateral address:"
 *    - Your collateral account's Solana public key (base58). The input is validated
 *      as a valid Solana address.
 *
 * Flow & Expectations:
 * 1. The script prints an intro message and prompts for network and collateral address.
 * 2. It creates a Connection to the chosen RPC and fetches the account with getAccountInfo.
 * 3. It reads the first 8 bytes of the account data as the discriminator.
 * 4. It compares the discriminator to the V1 and V2 values; if neither matches, it throws.
 * 5. It prints which example to follow: withdrawalV1 or withdrawalV2.
 *
 * Expected Outcome:
 * - If the account exists and has a known discriminator, the script prints:
 *   "Follow the withdrawalV{n}/index.ts example to withdraw from your collateral account."
 * - If the account is not found, data is too short, or the discriminator is unknown,
 *   the script throws an error and exits with code 1.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// Discriminator for collateral account V1 (8 bytes).
const DISCRIMINATOR_MULTISIGN_V1: number[] = [
  123, 130, 234, 63, 255, 240, 255, 92,
];
// Discriminator for collateral account V2 (8 bytes).
const DISCRIMINATOR_MULTISIGN_V2: number[] = [
  165, 86, 67, 157, 199, 120, 39, 111,
];
/** Discriminator of the SingleSignerCollateral account type */
const DISCRIMINATOR_SINGLE_SIGNER: number[] = [19, 45, 99, 29, 196, 50, 228, 117];

function discriminatorMatches(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

async function main(): Promise<void> {
  console.log('This CLI will help you select the correct withdrawal example to use based on the version of your collateral account.');
  const { network, address } = await inquirer.prompt([
    {
      type: "list",
      name: "network",
      message: "Select the Solana network",
      choices: [
        { name: "Mainnet", value: "mainnet" },
        { name: "Devnet", value: "devnet" },
      ],
    },
    {
      type: "input",
      name: "address",
      message: "Enter the Collateral address:",
      validate: (input: string) => {
        try {
          new PublicKey(input);
          return true;
        } catch {
          return "Please enter a valid Solana address (base58).";
        }
      },
    },
  ]);

  const rpcUrl = network === "mainnet" ? MAINNET_RPC_URL : DEVNET_RPC_URL;
  const collateralAccountAddress = new PublicKey(address);

  const version = await getCollateralVersion(collateralAccountAddress, rpcUrl);
  console.log(`\nFollow the ${version}/index.ts example to withdraw from your collateral account.`);
}

async function getCollateralVersion(
  collateralAccountAddress: PublicKey,
  rpcUrl: string
): Promise<string> {
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  const accountInfo = await connection.getAccountInfo(collateralAccountAddress);

  if (!accountInfo ) {
    throw new Error("Collateral account not found.");
  } else if (accountInfo.data.length < 8) {
    throw new Error("Collateral account data is too short.");
  }

  const discriminator = Array.from(accountInfo.data.slice(0, 8));

  if (discriminatorMatches(discriminator, DISCRIMINATOR_MULTISIGN_V1)) {
    return `withdrawal/multisign_program_v2_00`;
  } else if (discriminatorMatches(discriminator, DISCRIMINATOR_MULTISIGN_V2)) {
    return `withdrawal/multisign_program_v2_01`;
  } else if (discriminatorMatches(discriminator, DISCRIMINATOR_SINGLE_SIGNER)) {
    return `withdrawal/single_signer_(squad_)program_v2_02`;
  } else {
    throw new Error(
      `Unknown account discriminator: ${discriminator.join(",")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
