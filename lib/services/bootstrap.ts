import type { DB } from "../db";
import { bootstrapOwner, userCount } from "../auth";

/** If OWNER_EMAIL / OWNER_PASSWORD are set and no users exist, create the Owner once. */
export async function ensureEnvOwner(db: DB) {
  const email = process.env.OWNER_EMAIL?.trim();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;
  if ((await userCount(db)) > 0) return;
  try {
    await bootstrapOwner(db, { email, password, name: process.env.OWNER_NAME || "Owner" });
  } catch {
    // someone else won the race, or the password is too weak: fall back to the setup screen
  }
}
