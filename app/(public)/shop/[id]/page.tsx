import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { getPublicProduct } from "@/lib/services/catalog";
import { getSettings } from "@/lib/services/settings";
import { ProductActions } from "./actions";

export const dynamic = "force-dynamic";

async function load(id: string) {
  try {
    const db = await getDb();
    const [product, settings] = await Promise.all([getPublicProduct(db, id), getSettings(db)]);
    return { product, settings };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await load((await params).id);
  if (!r) return { title: "Not available" };
  return {
    title: r.product.name,
    description: `${r.product.name} — ${formatINR(r.product.pricePaise)}. Sizes ${r.product.sizes.join(", ")}.`,
    openGraph: { title: r.product.name, images: r.product.images.slice(0, 1) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await load((await params).id);
  if (!r) notFound();
  const { product: p, settings } = r;
  const number = settings.whatsappNumber || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-8 lg:grid-cols-2 lg:gap-16">
      <ProductActions product={p} whatsapp={number} phone={settings.phone} />
    </div>
  );
}
