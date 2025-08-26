import { PublicKey } from "@solana/web3.js";
import { TransferCollateralTeamRequest } from "./types";
import crypto from "crypto-js";

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

// ---------------------SIGNATURES MESSAGE BUILDER---------------------

interface ISignatureMessage {
  encode(): string;
}

export class SignatureMessageBuilder {
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

export class PaddingBytesMessage implements ISignatureMessage {
  encode(): string {
    const encoded = HashUtils.encodeBytes(new Uint8Array(Buffer.from("\x19\x01", "latin1")));
    return encoded;
  }
}

export class DomainSeparatorMessage implements ISignatureMessage {
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

// ---------------------MESSAGES---------------------

/**
 * Message that represents the transfer collateral team request.
 */
export class TransferCollateralTeamMessage {
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
