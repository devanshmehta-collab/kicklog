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

export function isSafeKey(key: string) {
  return KEY_RE.test(key);
}

/** Validate (magic bytes + size) and persist an image. kind "product" → publicly readable; "bill" → private. */
export async function saveImage(data: Buffer, kind: "product" | "bill"): Promise<StoredFile> {
  if (data.length > MAX_IMAGE_BYTES) throw badRequest("Image is larger than 8 MB");
  const type = sniffImageType(data);
  if (!type) throw badRequest("Unsupported or corrupt image (JPEG, PNG, WebP or GIF only)");
  const key = `${kind === "product" ? "p" : "b"}-${crypto.randomBytes(16).toString("hex")}.${extensionFor(type)}`;
  if (process.env.STORAGE_DRIVER === "s3") {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    await s3(S3Client).send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: data, ContentType: type }));
  } else {
    if (process.env.VERCEL) throw badRequest("Image storage is not configured. Set STORAGE_DRIVER=s3 and the S3_* variables (Vercel has no writable disk).");
    await fs.mkdir(UPLOAD_DIR(), { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR(), key), data);
  }
  return { key, contentType: type, bytes: data };
}

export async function readImage(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isSafeKey(key)) return null;
  const ext = key.split(".").pop()!;
  const contentType = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext]!;
  try {
    if (process.env.STORAGE_DRIVER === "s3") {
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
