/** Bounded-concurrency map — preserves input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const work = items.map((item, index) => ({ item, index }));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const next = work[cursor];
      cursor += 1;
      if (!next) return;
      results[next.index] = await mapper(next.item, next.index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
