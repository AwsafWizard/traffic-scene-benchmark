import crypto from "node:crypto";

/**
 * Encrypts provider API keys before they're stored, with AES-256-GCM under
 * ENCRYPTION_KEY (32 random bytes, base64). A database leak alone doesn't expose
 * the keys. Changing ENCRYPTION_KEY makes stored keys unreadable: re-enter them.
 *
 * Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "";
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 random bytes, base64-encoded.");
  return buf;
}

export function encryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith("v1:")) throw new Error("Unknown secret format");
  const raw = Buffer.from(stored.slice(3), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
