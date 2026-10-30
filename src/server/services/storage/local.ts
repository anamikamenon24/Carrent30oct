import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * Stores uploads in a private folder outside `public/`, so files are only reachable
 * through app code that checks permissions.
 */
export class LocalFileStorage implements FileStorage {
  readonly name = "local";
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
    const publicDir = path.resolve("public");
    if (this.root === publicDir || this.root.startsWith(publicDir + path.sep)) {
      throw new Error("Uploads folder must not be inside the public folder");
    }
  }

  async put(key: string, body: Uint8Array) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string) {
    try {
      return (await stat(this.resolve(key))).isFile();
    } catch {
      return false;
    }
  }

  private resolve(key: string) {
    if (!KEY_PATTERN.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return file;
  }
}
