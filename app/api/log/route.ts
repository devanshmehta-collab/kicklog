import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { interpretWithClaude, type InterpretImage, type Interpreter } from "@/lib/ai/client";
import { mockInterpreter } from "@/lib/ai/mock";
import { badRequest } from "@/lib/errors";
import { MAX_IMAGES_PER_LOG } from "@/lib/image";
import { runQuickLog } from "@/lib/services/quicklog";
import { saveImage } from "@/lib/storage";

export const maxDuration = 60;

function pickInterpreter(): Interpreter {
  return process.env.AI_MODE === "mock" && process.env.NODE_ENV !== "production" ? mockInterpreter : interpretWithClaude;
}

/**
 * AI Quick Log. multipart/form-data: text, idempotencyKey, images[] (0..4).
 * Claude is called here on the server only.
 */
export const POST = api({ roles: WRITE, rate: [40, 60_000] }, async ({ req, db, user }) => {
  const form = await req.formData();
  const text = String(form.get("text") ?? "").slice(0, 2000);
  const idempotencyKey = z.string().min(8).max(100).parse(form.get("idempotencyKey"));
  const files = form.getAll("images").filter((f): f is File => typeof f !== "string");
  if (!text.trim() && files.length === 0) throw badRequest("Type what happened or attach a photo");
  if (files.length > MAX_IMAGES_PER_LOG) throw badRequest(`At most ${MAX_IMAGES_PER_LOG} images per entry`);

  const images: InterpretImage[] = [];
  const imageKeys: string[] = [];
  for (const f of files) {
    const stored = await saveImage(Buffer.from(await f.arrayBuffer()), "bill");
    imageKeys.push(stored.key);
    images.push({ mediaType: stored.contentType, base64: stored.bytes.toString("base64") });
  }
  return runQuickLog(db, { text, images, imageKeys, idempotencyKey, userId: user.id, interpreter: pickInterpreter() });
});
