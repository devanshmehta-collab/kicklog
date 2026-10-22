/**
 * Optional demo data: npm run seed
 * Creates a few products, one co-investing partner and one published catalogue item through the real services.
 * Safe to skip in production.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../lib/db";
import { createPurchase, updateProduct } from "../lib/services/inventory";
import { createPartner } from "../lib/services/partners";
import { recordSale } from "../lib/services/sales";

async function main() {
  const db = await getDb();
  const partner = await createPartner(db, { name: "Demo Partner" });
  const jordan = await createPurchase(db, {
    idempotencyKey: `seed:${randomUUID()}`,
    product: { name: "Air Jordan 1 High Chicago", brand: "Jordan", category: "sneakers", colorway: "White/Varsity Red", sku: "DZ5485-612", publicPricePaise: 2_400_000 },
    size: "10",
    quantity: 2,
    totalCostPaise: 3_600_000,
    partners: [{ partnerId: partner.id, ownershipBps: 5000, profitShareBps: 5000 }],
  });
  await updateProduct(db, jordan.productId, { status: "published" });
  await createPurchase(db, {
    idempotencyKey: `seed:${randomUUID()}`,
    product: { name: "Nike Dunk Low Panda", brand: "Nike", category: "sneakers", publicPricePaise: 1_450_000 },
    size: "9",
    quantity: 1,
    totalCostPaise: 1_200_000,
  });
  await recordSale(db, {
    idempotencyKey: `seed:${randomUUID()}`,
    lines: [{ variantId: jordan.variantId, quantity: 1, unitPricePaise: 2_200_000 }],
    costs: { shippingCostPaise: 50_000 },
    customer: { name: "Demo Buyer", phone: "919800000000" },
  });
  console.log("Seeded demo data.");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
