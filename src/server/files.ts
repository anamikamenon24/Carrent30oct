import "server-only";
import { randomUUID } from "node:crypto";
import { getStorage } from "@/server/services";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const SIGNATURES: { type: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  { type: "application/pdf", ext: "pdf", test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

/** Detects the real file type from its first bytes (never trust the browser's content type). */
export function sniffType(bytes: Uint8Array): { type: string; ext: string } | null {
  return SIGNATURES.find((s) => s.test(bytes)) ?? null;
}

export type UploadResult = { ok: true; key: string } | { ok: false; error: string };

/**
 * Validates and stores an uploaded file under `prefix/<uuid>.<ext>` in private storage.
 * `allowPdf` permits PDFs (licences); images are always allowed.
 */
export async function storeUpload(file: File, prefix: string, { allowPdf = false } = {}): Promise<UploadResult> {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 8 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffType(bytes);
  if (!kind || (kind.type === "application/pdf" && !allowPdf)) {
    return { ok: false, error: allowPdf ? "Upload a JPG, PNG, WebP or PDF file." : "Upload a JPG, PNG or WebP image." };
  }
  const key = `${prefix}/${randomUUID()}.${kind.ext}`;
  await getStorage().put(key, bytes);
  return { ok: true, key };
}

/** Builds a response for a privately stored file. */
export async function fileResponse(key: string, { cache = "private, no-store" } = {}): Promise<Response> {
  const bytes = await getStorage().get(key);
  if (!bytes) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const kind = sniffType(bytes);
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": kind?.type ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}

export const notFoundResponse = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
