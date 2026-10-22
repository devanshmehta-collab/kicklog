"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

let csrf = "";
export const setCsrf = (t: string) => {
  csrf = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.method && init.method !== "GET" && csrf) headers.set("x-csrf-token", csrf);
  const res = await fetch(url, { ...init, headers, body, credentials: "same-origin" });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: usually a platform error page (timeout, crash). Say what happened instead of a generic failure.
    if (!res.ok) throw new ApiError(res.status, "bad_response", res.status === 504 || res.status === 408 ? "The server took too long to answer (timeout). Please try again." : `The server returned an error (${res.status}). Check the deployment logs.`);
    throw new ApiError(res.status, "bad_response", "The server sent an unreadable response.");
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? res.statusText, data?.error?.details);
  }
  return data as T;
}

export function useGet<T>(key: QueryKey, url: string | null, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => apiFetch<T>(url!),
    enabled: url != null && opts.enabled !== false,
    refetchInterval: opts.refetchInterval,
  });
}

/** Mutations refresh every query by default: the ledger is cheap to re-read and stale money is worse than an extra request. */
export function useSend<TIn = unknown, TOut = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string | ((v: TIn) => string), opts: { invalidate?: QueryKey[] } = {}) {
  const qc = useQueryClient();
  return useMutation<TOut, ApiError, TIn>({
    mutationFn: (v) => apiFetch<TOut>(typeof url === "function" ? url(v) : url, { method, json: v ?? {} }),
    onSuccess: () => {
      if (opts.invalidate) opts.invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      else qc.invalidateQueries();
    },
  });
}

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
