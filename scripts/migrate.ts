import { createDb } from "../lib/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for db:migrate");
  const { close } = await createDb({ url });
  await close();
  console.log("Migrations applied.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
