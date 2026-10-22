import { AppError } from "./errors";

/** In-memory sliding-window limiter. Per-instance; put a shared store (Redis) behind it if you run many replicas. */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    throw new AppError(429, "rate_limited", "Too many requests — please slow down and retry shortly");
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
}

export function resetRateLimits() {
  hits.clear();
}
