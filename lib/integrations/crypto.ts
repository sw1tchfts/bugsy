// Server code only (it reads the integration secret). Tokens for connected services, encrypted at rest with the app's integration secret (AES-256-GCM). Members never
// read the column; only the app decrypts it to call the service (spec 20).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const secret = process.env.INTEGRATION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "bugsy-dev-integration-secret");
  if (!secret) throw new Error("INTEGRATION_SECRET is not set");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function open<T>(sealed: string | null): T | null {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")) as T;
}
