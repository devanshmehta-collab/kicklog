import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { deleteProductImage, setPrimaryImage } from "@/lib/services/inventory";

/** Make this photo the main photo. */
export const PATCH = api({ roles: WRITE, body: z.object({ primary: z.literal(true) }) }, async ({ db, params }) => setPrimaryImage(db, params.id, params.imageId));

export const DELETE = api({ roles: WRITE }, async ({ db, params }) => deleteProductImage(db, params.id, params.imageId));
