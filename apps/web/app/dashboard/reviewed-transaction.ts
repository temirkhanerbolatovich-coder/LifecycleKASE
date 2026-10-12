import { encodeBase58, unsignedTransactionForSigner } from "./snapshot-workflow";

export type ReviewedInstruction = { program: string; accounts: string[]; data: string };
export const transactionHex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** Check canonical v0 framing, the complete instruction list and every account privilege before signing. */
export function requireReviewedTransaction(wire: string, signer: string, expected: ReviewedInstruction[], writable: ReadonlySet<string>, invalid: () => Error): void {
  const bytes = unsignedTransactionForSigner(wire, signer); let offset = 69;
  const read = () => { if (offset >= bytes.length) throw invalid(); return bytes[offset++]!; };
  const count = () => {
    let value = 0;
    for (let index = 0; index < 3; index++) {
      const byte = read(); value |= (byte & 127) << (index * 7);
      if (index === 2 && byte > 3 || index > 0 && byte === 0) throw invalid();
      if (byte < 128) return value;
    }
    throw invalid();
  };
  const keys = Array.from({ length: count() }, () => {
    const value = bytes.slice(offset, offset + 32); offset += 32;
    if (value.length !== 32) throw invalid(); return encodeBase58(value);
  });
  offset += 32;
  if (bytes[67] !== 0 || count() !== expected.length) throw invalid();
  for (const instruction of expected) {
    const program = keys[read()]; const accounts = Array.from({ length: count() }, () => keys[read()]);
    const length = count(); const data = bytes.slice(offset, offset + length); offset += length;
    if (data.length !== length || program !== instruction.program || transactionHex(data) !== instruction.data ||
        JSON.stringify(accounts) !== JSON.stringify(instruction.accounts)) throw invalid();
  }
  const expectedKeys = new Set(expected.flatMap(instruction => [instruction.program, ...instruction.accounts]));
  if (count() !== 0 || offset !== bytes.length || keys.length !== expectedKeys.size || new Set(keys).size !== keys.length ||
      keys.some((value, index) => !expectedKeys.has(value) || writable.has(value) !== (index === 0 || index < keys.length - bytes[68]!))) throw invalid();
}
