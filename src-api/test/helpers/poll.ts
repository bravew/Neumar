export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<T | undefined> {
  const timeout = opts?.timeoutMs ?? 10_000;
  const interval = opts?.intervalMs ?? 100;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await fn();
    if (result != null) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
  return undefined;
}
