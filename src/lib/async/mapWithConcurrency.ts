/**
 * Map items with at most `limit` mappers running at the same time.
 * @param items - Inputs, processed in order of start.
 * @param limit - Maximum parallel mappers (>= 1).
 * @param mapper - Async work per item.
 * @returns Results in the same order as `items`.
 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
};
