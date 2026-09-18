/** Find the closest absolute timestamp in an ascending list; ties prefer the earlier row. */
export function nearestTimestampIndex(times: readonly number[], target: number): number {
  if (!times.length || !Number.isFinite(target)) return -1;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] < target) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  if (low === times.length) return low - 1;
  return target - times[low - 1] <= times[low] - target ? low - 1 : low;
}

export function shouldSplitSignaling(location: string | null | undefined): boolean {
  return !!location?.trim() && !/gsm/i.test(location);
}
