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
      <header className="sticky top-0 z-30 h-14 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[1500px] items-center justify-between px-4 sm:px-8">
          <Link href="/" className="font-display text-[22px] leading-none font-bold tracking-tight">
            {name}
            <span className="text-accent">.</span>
          </Link>
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-semibold text-black transition hover:brightness-110">
              <MessageCircle size={15} /> Chat
            </a>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-24 border-t border-line/60 py-8">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 text-xs text-muted sm:px-8">
          <span>© {new Date().getFullYear()} {name}</span>
          <Link href="/login" className="hover:text-fg">Seller sign in</Link>
        </div>
      </footer>
    </div>
  );
}
