import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { addProductImage } from "@/lib/services/inventory";
import { badRequest } from "@/lib/errors";
import { fileUrl, saveImage } from "@/lib/storage";

/** multipart: file, primary=1 (optional). Product images are served publicly under /api/files/p-*. */
export const POST = api({ roles: WRITE }, async ({ req, db, params }) => {
  const form = await req.formData();
  const f = form.get("file");
  if (!f || typeof f === "string") throw badRequest("Attach an image file");
  const stored = await saveImage(Buffer.from(await f.arrayBuffer()), "product");
  return addProductImage(db, params.id, fileUrl(stored.key), form.get("primary") === "1");
});
