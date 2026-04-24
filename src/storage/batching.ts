/**
 * Shared helpers for working around Postgres' bind-parameter cap
 * (~65535 parameters per statement).
 *
 * Used by repositories that would otherwise generate oversized multi-row
 * INSERTs or oversized `IN (...)` lookups.
 */

/** Bind-parameter budget per INSERT, kept safely below Postgres' 65535 cap. */
export const INSERT_PARAMETER_BUDGET = 60_000;

/** Hard ceiling on rows per INSERT batch regardless of column count. */
export const MAX_INSERT_ROWS_PER_BATCH = 1_000;

/** Default batch size for `IN (...)` lookups of primitive values. */
export const IN_LIST_BATCH_SIZE = 1_000;

/** Split an array into consecutive batches of at most `size` items. */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Run `fn` sequentially for each chunk of `items` sized `size`.
 * Callers accumulate results via closure.
 */
export async function inBatches<T>(
  items: readonly T[],
  size: number,
  fn: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (const batch of chunkArray(items, size)) {
    await fn(batch);
  }
}

/**
 * Largest safe INSERT batch size for the given rows, based on their
 * (non-undefined) column count and the bind-parameter budget.
 */
export function computeInsertBatchSize(
  rows: readonly Record<string, unknown>[],
): number {
  let maxValuesPerRow = 1;
  for (const row of rows) {
    let count = 0;
    for (const value of Object.values(row)) {
      if (value !== undefined) count++;
    }
    if (count > maxValuesPerRow) maxValuesPerRow = count;
  }
  return Math.max(
    1,
    Math.min(
      MAX_INSERT_ROWS_PER_BATCH,
      Math.floor(INSERT_PARAMETER_BUDGET / maxValuesPerRow),
    ),
  );
}
