import { Connection, PublicKey } from "@solana/web3.js";
import inquirer from "inquirer";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// Discriminator for collateral account V1 (8 bytes).
const DISCRIMINATOR_V1: number[] = [
  123, 130, 234, 63, 255, 240, 255, 92,
];
// Discriminator for collateral account V2 (8 bytes).
const DISCRIMINATOR_V2: number[] = [
  165, 86, 67, 157, 199, 120, 39, 111,
];

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
  console.log('');
  console.log(`Follow the withdrawalV${version}/index.ts example to withdraw from your collateral account.`);
}

async function getCollateralVersion(
  collateralAccountAddress: PublicKey,
  rpcUrl: string
): Promise<number> {
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  const accountInfo = await connection.getAccountInfo(collateralAccountAddress);

  if (!accountInfo ) {
    throw new Error("Collateral account not found.");
  } else if (accountInfo.data.length < 8) {
    throw new Error("Collateral account data is too short.");
  }

  const discriminator = Array.from(accountInfo.data.slice(0, 8));

  if (discriminatorMatches(discriminator, DISCRIMINATOR_V1)) {
    return 1;
  } else if (discriminatorMatches(discriminator, DISCRIMINATOR_V2)) {
    return 2;
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
