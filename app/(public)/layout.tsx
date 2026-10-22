import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings(await getDb());
  const name = s.businessName || "Kick Log";
  const wa = s.whatsappNumber || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-4 sm:px-8">
          <Link href="/" className="text-[15px] font-semibold tracking-[0.18em] uppercase">{name}</Link>
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg hover:bg-fg/90">
              <MessageCircle size={15} /> Chat
            </a>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-20 py-8 text-center text-xs text-muted">
        © {new Date().getFullYear()} {name} · <Link href="/login" className="hover:text-fg">Seller sign in</Link>
      </footer>
    </div>
  );
}
