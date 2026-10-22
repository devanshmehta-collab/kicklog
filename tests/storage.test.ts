import { beforeEach, describe, expect, it, vi } from "vitest";

const { put, get } = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, get }));

import { readImage, saveImage, storageDriver, storageProblem } from "@/lib/storage";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
const ENV_KEYS = ["STORAGE_DRIVER", "BLOB_READ_WRITE_TOKEN", "S3_BUCKET", "VERCEL"] as const;

beforeEach(() => {
  put.mockReset();
  get.mockReset();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("storage driver selection", () => {
  it("defaults to local, prefers Blob when its token exists, then S3", () => {
    expect(storageDriver({})).toBe("local");
    expect(storageDriver({ BLOB_READ_WRITE_TOKEN: "t" })).toBe("blob");
    expect(storageDriver({ S3_BUCKET: "b" })).toBe("s3");
    expect(storageDriver({ BLOB_READ_WRITE_TOKEN: "t", S3_BUCKET: "b" })).toBe("blob");
    expect(storageDriver({ BLOB_READ_WRITE_TOKEN: "t", STORAGE_DRIVER: "s3" })).toBe("s3");
  });
  it("explains what is missing on Vercel", () => {
    expect(storageProblem({ VERCEL: "1" })).toMatch(/Storage → Create → Blob/);
    expect(storageProblem({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "t" })).toBeNull();
    expect(storageProblem({ STORAGE_DRIVER: "blob" })).toMatch(/BLOB_READ_WRITE_TOKEN is missing/);
    expect(storageProblem({})).toBeNull(); // local dev is fine
  });
});

describe("Vercel Blob storage", () => {
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
  });

  it("uploads under the generated key with the sniffed content type", async () => {
    put.mockResolvedValue({ url: "https://x" });
    const f = await saveImage(PNG, "product");
    expect(f.key).toMatch(/^p-[a-f0-9]{32}\.png$/);
    expect(put).toHaveBeenCalledWith(f.key, PNG, expect.objectContaining({ access: "public", contentType: "image/png", addRandomSuffix: false }));
  });

  it("switches to private access when the store is private, and remembers it", async () => {
    put.mockRejectedValueOnce(new Error("Cannot use public access on a private store")).mockResolvedValue({ url: "https://x" });
    const f = await saveImage(PNG, "bill");
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][2]).toMatchObject({ access: "private" });
    expect(f.key).toMatch(/^b-/);
  });

  it("reads files back through the blob store", async () => {
    get.mockResolvedValue({ statusCode: 200, stream: new Response(PNG).body });
    const r = await readImage("p-0123456789abcdef0123456789abcdef.png");
    expect(r?.contentType).toBe("image/png");
    expect(r?.bytes.equals(PNG)).toBe(true);
  });

  it("returns null for missing files and refuses unsafe keys", async () => {
    get.mockResolvedValue(null);
    expect(await readImage("p-0123456789abcdef0123456789abcdef.png")).toBeNull();
    expect(await readImage("../../secret.png")).toBeNull();
    expect(get).toHaveBeenCalledTimes(2); // tried public then private
  });

  it("still rejects non-images and oversized files before touching storage", async () => {
    await expect(saveImage(Buffer.from("<html>"), "product")).rejects.toMatchObject({ status: 400 });
    await expect(saveImage(Buffer.alloc(9 * 1024 * 1024), "product")).rejects.toMatchObject({ status: 400 });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("misconfigured Vercel deploy", () => {
  it("fails with the Blob setup instructions", async () => {
    process.env.VERCEL = "1";
    await expect(saveImage(PNG, "product")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Blob/) });
  });
});
