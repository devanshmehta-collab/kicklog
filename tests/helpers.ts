import { createDb, type DB } from "@/lib/db";
import { mockInterpreter } from "@/lib/ai/mock";
import type { InterpretRequest, Interpreter } from "@/lib/ai/client";
import { runQuickLog } from "@/lib/services/quicklog";
import { users } from "@/lib/db/schema";

export async function testDb() {
  const { db, close } = await createDb();
  const [u] = await db.insert(users).values({ email: "t@t.test", name: "Tester", passwordHash: "x", role: "owner" }).returning();
  return { db: db as DB, close, userId: u.id };
}

let n = 0;
export const key = () => `k-${++n}-${Math.random().toString(36).slice(2)}`;

export function log(db: DB, userId: string, text: string, opts: { interpreter?: Interpreter; images?: InterpretRequest["images"]; key?: string } = {}) {
  return runQuickLog(db, {
    text,
    images: opts.images ?? [],
    imageKeys: [],
    idempotencyKey: opts.key ?? key(),
    userId,
    interpreter: opts.interpreter ?? mockInterpreter,
  });
}
