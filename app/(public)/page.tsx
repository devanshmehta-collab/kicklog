import type { Metadata } from "next";
import { Storefront } from "@/components/storefront";
import { getDb } from "@/lib/db";
import { listPublicProducts } from "@/lib/services/catalog";
import { getSettings } from "@/lib/services/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Authentic sneakers & luxury",
  description: "Browse live stock and buy on WhatsApp.",
};

export default async function Home() {
  const db = await getDb();
  const [products, settings] = await Promise.all([listPublicProducts(db), getSettings(db)]);
  const wa = settings.whatsappNumber || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
  return <Storefront items={products} whatsapp={wa} />;
}
