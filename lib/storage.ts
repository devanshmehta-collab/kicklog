import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { extensionFor, sniffImageType, MAX_IMAGE_BYTES, type AllowedImageType } from "./image";
import { badRequest } from "./errors";

export interface StoredFile {
  key: string;
  contentType: AllowedImageType;
  bytes: Buffer;
}

const UPLOAD_DIR = () => path.join(process.cwd(), "uploads");
const KEY_RE = /^[a-z]+-[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export function isSafeKey(key: string) {
  return KEY_RE.test(key);
}

export type StorageDriver = "blob" | "s3" | "local";

/**
 * Vercel normally names the variable BLOB_READ_WRITE_TOKEN, but when a store is connected with a custom prefix
 * it becomes e.g. PHOTOS_READ_WRITE_TOKEN. Every Blob token starts with "vercel_blob_rw_", so find it by value.
 */
export function blobToken(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  return Object.values(env).find((v) => typeof v === "string" && v.startsWith("vercel_blob_rw_"));
}

/**
 * Newer Vercel Blob stores have no read-write token: Vercel signs requests with its built-in identity (OIDC) and the
 * only variable it adds is the store id, e.g. BLOB_READ_WRITE_TOKEN_STORE_ID or BLOB_STORE_ID.
 */
export function blobStoreId(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.BLOB_STORE_ID) return env.BLOB_STORE_ID;
  const k = Object.keys(env).find((key) => /^BLOB.*STORE_ID$/.test(key) && env[key]);
  return k ? env[k] : undefined;
}

/** How we will authenticate to Blob: an explicit token, Vercel identity + store id, or not at all. */
export function blobAuth(env: Record<string, string | undefined> = process.env): { token: string } | { storeId: string } | null {
  const token = blobToken(env);
  if (token) return { token };
  const storeId = blobStoreId(env);
  return storeId ? { storeId } : null;
}

/**
 * Which backend holds uploads:
 *   STORAGE_DRIVER=blob|s3|local wins; otherwise Vercel Blob when BLOB_READ_WRITE_TOKEN exists;
 *   otherwise S3 when S3_BUCKET exists; otherwise the local ./uploads folder (dev only).
 */
export function storageDriver(env: Record<string, string | undefined> = process.env): StorageDriver {
  const forced = env.STORAGE_DRIVER?.toLowerCase();
  if (forced === "blob" || forced === "s3" || forced === "local") return forced;
  if (blobAuth(env)) return "blob";
  if (env.S3_BUCKET) return "s3";
  return "local";
}

export function storageProblem(env: Record<string, string | undefined> = process.env): string | null {
  const d = storageDriver(env);
  if (d === "blob" && !blobAuth(env)) return "STORAGE_DRIVER=blob but no Blob credentials were found (BLOB_READ_WRITE_TOKEN or a BLOB…STORE_ID variable). In Vercel: Storage → Create → Blob, then connect it to this project.";
  if (d === "s3" && !env.S3_BUCKET) return "STORAGE_DRIVER=s3 but S3_BUCKET is missing.";
  if (d === "local" && env.VERCEL) return "No image storage is set up. In Vercel open Storage → Create → Blob and connect it to this project (it adds BLOB_READ_WRITE_TOKEN) and tick the Production environment, then redeploy.";
  return null;
}

// Vercel Blob stores are created either public or private. Prefer public (product photos are public anyway)
// and quietly switch if the store turns out to be private.
let blobAccess: "public" | "private" = "public";

async function blobPut(key: string, data: Buffer, contentType: string) {
  const { put } = await import("@vercel/blob");
  const opts = (access: "public" | "private") => ({ access, ...blobAuth(), contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 }) as Parameters<typeof put>[2];
  try {
    await put(key, data, opts(blobAccess));
  } catch (e) {
    if (/private/i.test((e as Error).message ?? "") && blobAccess === "public") {
      blobAccess = "private";
      await put(key, data, opts("private"));
    } else if (/public/i.test((e as Error).message ?? "") && blobAccess === "private") {
      blobAccess = "public";
      await put(key, data, opts("public"));
    } else throw e;
  }
}

async function blobRead(key: string): Promise<Buffer | null> {
  const { get } = await import("@vercel/blob");
  for (const access of [blobAccess, blobAccess === "public" ? "private" : "public"] as const) {
    try {
      const r = await get(key, { access, ...blobAuth() } as Parameters<typeof get>[1]);
      if (r && r.statusCode === 200) return Buffer.from(await new Response(r.stream).arrayBuffer());
    } catch {
      // try the other access mode
    }
  }
  return null;
}

/** Validate (magic bytes + size) and persist an image. kind "product" → publicly readable; "bill" → private. */
export async function saveImage(data: Buffer, kind: "product" | "bill"): Promise<StoredFile> {
  if (data.length > MAX_IMAGE_BYTES) throw badRequest("Image is larger than 8 MB");
  const type = sniffImageType(data);
  if (!type) throw badRequest("Unsupported or corrupt image (JPEG, PNG, WebP or GIF only)");
  const problem = storageProblem();
  if (problem) throw badRequest(problem);
  const key = `${kind === "product" ? "p" : "b"}-${crypto.randomBytes(16).toString("hex")}.${extensionFor(type)}`;
  const driver = storageDriver();
  if (driver === "blob") {
    await blobPut(key, data, type);
  } else if (driver === "s3") {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    await s3(S3Client).send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: data, ContentType: type }));
  } else {
    await fs.mkdir(UPLOAD_DIR(), { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR(), key), data);
  }
  return { key, contentType: type, bytes: data };
}

export async function readImage(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isSafeKey(key)) return null;
  const contentType = TYPES[key.split(".").pop()!]!;
  try {
    const driver = storageDriver();
    if (driver === "blob") {
      const bytes = await blobRead(key);
      return bytes ? { bytes, contentType } : null;
    }
    if (driver === "s3") {
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
      const res = await s3(S3Client).send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      return { bytes: Buffer.from(await res.Body!.transformToByteArray()), contentType };
    }
    return { bytes: await fs.readFile(path.join(UPLOAD_DIR(), key)), contentType };
  } catch {
    return null;
  }
}

let s3Client: unknown;
function s3<T extends new (c: object) => object>(Ctor: T): InstanceType<T> {
  s3Client ??= new Ctor({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! }
      : undefined,
  });
  return s3Client as InstanceType<T>;
}

export const fileUrl = (key: string) => `/api/files/${key}`;
