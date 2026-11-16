interface Entry {
  expires: number;
  value: Promise<unknown>;
}

// Survive Next.js dev hot reloads.
const g = globalThis as unknown as { __foodCache?: Map<string, Entry> };
const store = (g.__foodCache ??= new Map<string, Entry>());

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function cached<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = fn().catch((e) => {
    store.delete(key);
    throw e;
  });
  store.set(key, { expires: now + ttlMs, value });
  return value;
}
