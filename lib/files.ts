// Files (photos, signatures, documents) behind one small interface. Today they are rows in public.files under row
// level security; Supabase Storage replaces the inside of these functions later without touching callers.
import { createHash } from "node:crypto";
import type postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type StoredFile = { id: string; content_type: string; byte_size: number; data: Uint8Array };

export async function putFile(
  tx: Sql,
  tenantId: string,
  input: { kind: "photo" | "signature" | "document"; contentType: string; data: Uint8Array; clientId?: string | null },
): Promise<string> {
  if (input.data.byteLength < 1 || input.data.byteLength > MAX_FILE_BYTES) throw Object.assign(new Error("a file is between 1 byte and 5 MB"), { code: "23514" });
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  if (input.clientId) {
    const [existing] = await tx<{ id: string }[]>`select id from public.files where client_id = ${input.clientId}`;
    if (existing) return existing.id;
  }
  const [row] = await tx<{ id: string }[]>`
    insert into public.files (tenant_id, kind, content_type, byte_size, sha256, data, client_id)
    values (${tenantId}, ${input.kind}, ${input.contentType}, ${input.data.byteLength}, ${sha256}, ${Buffer.from(input.data)}, ${input.clientId ?? null})
    returning id`;
  return row.id;
}

export async function getFile(tx: Sql, tenantId: string, fileId: string): Promise<StoredFile | null> {
  const [row] = await tx<{ id: string; content_type: string; byte_size: number; data: Uint8Array }[]>`
    select id, content_type, byte_size, data from public.files where id = ${fileId} and tenant_id = ${tenantId}`;
  return row ?? null;
}

/** The URL the browser loads a file from; served under the viewer's own session. */
export function fileUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

/** Decodes a data URL or bare base64 string from a device into bytes and a content type. */
export function decodeBase64File(input: string, fallbackType = "application/octet-stream"): { contentType: string; data: Uint8Array } {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(input);
  const contentType = match?.[1] || fallbackType;
  const payload = match ? match[3] : input;
  return { contentType, data: new Uint8Array(Buffer.from(payload, "base64")) };
}
