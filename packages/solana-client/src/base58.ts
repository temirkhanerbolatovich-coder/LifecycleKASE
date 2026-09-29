const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodePublicKey(value: string): Uint8Array {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) {
    throw new Error("Expected a base58-encoded 32-byte public key");
  }
  let number = 0n;
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) {
      throw new Error("Expected a base58-encoded 32-byte public key");
    }
    number = number * 58n + BigInt(digit);
  }
  const rawHex = number === 0n ? "" : number.toString(16);
  const hex = rawHex.length % 2 === 0 ? rawHex : "0" + rawHex;
  const significant = hex ? Buffer.from(hex, "hex") : Buffer.alloc(0);
  const leadingZeros = value.length - value.replace(/^1+/, "").length;
  const result = Buffer.concat([Buffer.alloc(leadingZeros), significant]);
  if (result.length !== 32) {
    throw new Error("Expected a base58-encoded 32-byte public key");
  }
  return result;
}

export function encodePublicKey(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error("Public key must contain 32 bytes");
  }
  let number = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let encoded = "";
  while (number > 0n) {
    const digit = Number(number % 58n);
    encoded = ALPHABET[digit]! + encoded;
    number /= 58n;
  }
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeros += 1;
  }
  return "1".repeat(leadingZeros) + encoded;
}
