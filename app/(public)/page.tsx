import type { Metadata } from "next";
import { CatalogGrid } from "@/components/catalog-grid";
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
  return (
    <div className="mx-auto max-w-[1500px] px-4 pt-8 pb-4 sm:px-8">
      {products.length > 0 ? <CatalogGrid items={products} whatsapp={wa} /> : <p className="py-32 text-center text-muted">New drops landing soon.</p>}
    </div>
  );
}
