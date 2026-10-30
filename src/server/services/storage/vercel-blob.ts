import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { FileStorage } from "./types";

/**
 * Vercel Blob storage (STORAGE_PROVIDER=vercel-blob). Every object is stored with `access: "private"`,
 * so licence and damage images are only reachable through app routes that check permissions
 * (vehicle photos are served by /api/files/vehicles/<key> the same way).
 * Needs BLOB_READ_WRITE_TOKEN (added by the Vercel Blob integration). Not exercised locally.
 */
export class VercelBlobStorage implements FileStorage {
  readonly name = "vercel-blob";

  constructor(private readonly token: string) {
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for STORAGE_PROVIDER=vercel-blob");
  }

  async put(key: string, body: Uint8Array) {
    await put(key, Buffer.from(body), {
      access: "private",
      token: this.token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async get(key: string) {
    const res = await get(key, { access: "private", token: this.token, useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  }

  async delete(key: string) {
    await del(key, { token: this.token });
  }

  async exists(key: string) {
    try {
      await head(key, { token: this.token });
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }
}
