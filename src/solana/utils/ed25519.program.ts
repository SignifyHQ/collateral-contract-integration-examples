import { Ed25519Program, PublicKey, TransactionInstruction } from '@solana/web3.js';

const INSTRUCTION_INDEX = 2 ** 16 - 1;
const SIGNATURE_STRUCTURE_SIZE = 14;
const PUBKEY_SIZE = 32;
const SIGNATURE_SIZE = 64;
const MESSAGE_SIZE = 32;
const SIGNATURE_DATA_SIZE = PUBKEY_SIZE + SIGNATURE_SIZE + MESSAGE_SIZE;
const SIGNATURE_DATA_PLUS_STRUCTURE_SIZE = SIGNATURE_STRUCTURE_SIZE + SIGNATURE_DATA_SIZE;

export type SignatureVerificationData = {
  signer: PublicKey;
  signature: Buffer;
  message: Buffer;
}

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

export class Ed25519ExtendedProgram extends Ed25519Program {
  static createSignatureVerificationInstruction(
    signatures: SignatureVerificationData[],
  ): TransactionInstruction {
    // Define the data buffer. We add 2 bytes for the number of signatures and padding bytes
    const dataBuffer = Buffer.alloc(signatures.length * SIGNATURE_DATA_PLUS_STRUCTURE_SIZE + 2);

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
