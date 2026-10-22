"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { SessionUser } from "@/lib/auth";
import { ApiError, apiFetch, setCsrf } from "@/lib/client/api";

interface Me {
  user: SessionUser;
  csrfToken: string;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useMe() {
  const q = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const me = await apiFetch<Me>("/api/auth/me");
        setCsrf(me.csrfToken);
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
  return { me: q.data ?? null, loading: q.isLoading, user: q.data?.user ?? null };
}

export function canWrite(role?: string) {
  return role === "owner" || role === "admin";
}
