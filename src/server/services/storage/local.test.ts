import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage } from "./local";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "driveeasy-uploads-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("LocalFileStorage", () => {
  it("stores, reads and deletes files", async () => {
    const s = new LocalFileStorage(dir);
    await s.put("licences/u1/front.jpg", new Uint8Array([1, 2, 3]));
    expect(await s.exists("licences/u1/front.jpg")).toBe(true);
    expect(await s.get("licences/u1/front.jpg")).toEqual(new Uint8Array([1, 2, 3]));
    await s.delete("licences/u1/front.jpg");
    expect(await s.get("licences/u1/front.jpg")).toBeNull();
  });

  it("rejects keys that escape the uploads folder", async () => {
    const s = new LocalFileStorage(dir);
    for (const key of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a//b", ""]) {
      await expect(s.put(key, new Uint8Array())).rejects.toThrow(/Invalid storage key/);
    }
  });

  it("refuses an uploads folder inside public/", () => {
    expect(() => new LocalFileStorage("public/uploads")).toThrow(/public/);
  });
});
