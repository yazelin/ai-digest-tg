export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<boolean> {
  const rlKey = `ratelimit:${key}`;
  const raw = await kv.get(rlKey);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= maxAttempts) return false;
  await kv.put(rlKey, String(count + 1), { expirationTtl: windowSeconds });
  return true;
}
