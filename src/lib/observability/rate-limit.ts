export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function createInMemoryRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = options.maxKeys ?? 5_000;

  return {
    check(key: string, now = Date.now()): RateLimitResult {
      if (entries.size >= maxKeys && !entries.has(key)) {
        for (const [candidate, entry] of entries) {
          if (entry.resetAt <= now) entries.delete(candidate);
          if (entries.size < maxKeys) break;
        }
      }
      if (entries.size >= maxKeys && !entries.has(key)) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(options.windowMs / 1_000) };
      }
      const current = entries.get(key);
      if (!current || current.resetAt <= now) {
        entries.set(key, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true, remaining: Math.max(0, options.limit - 1), retryAfterSeconds: 0 };
      }
      if (current.count >= options.limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)) };
      }
      current.count += 1;
      return { allowed: true, remaining: options.limit - current.count, retryAfterSeconds: 0 };
    },
    reset() {
      entries.clear();
    },
  };
}
