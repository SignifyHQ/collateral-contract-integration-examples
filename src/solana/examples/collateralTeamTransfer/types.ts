import { PublicKey } from "@solana/web3.js";

// ---------------------TYPES---------------------
export type Base58SecretKey = string;
export type Base58PublicKey = string;

export type SignatureVerificationData = {
  signer: PublicKey;
  signature: Buffer;
  message: Buffer;
};

export type TransferCollateralTeamRequest = {
  newName: string;
  newAdmins: PublicKey[];
  newAdminThreshold: number;
};

export type TransferCollateralTeamParams = {
  collateralAddress: Base58PublicKey;
  programId: Base58PublicKey;
  newAdminAddress: Base58PublicKey;
};
