/** One page of a list, with where it sits: `page` is 1-based and always within 1..`pages` (at least 1, for an empty list). */
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
}

/** A `?page=` value as the page asked for: anything that isn't a plain number reads as 1 (the list clamps it to its pages). */
export function pageParam(value: string | undefined): number {
  return /^\d{1,6}$/.test(value ?? "") ? Number(value) : 1;
}

/** How many pages `total` rows fill at `size` a page, and `wanted` clamped to them. */
export function pageBounds(total: number, wanted: number, size: number): { page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  return { page: Math.min(pages, Math.max(1, Math.floor(wanted))), pages };
}

/** One page of a list already read in full (Collect: its counts need every vendor, so the page is cut after the read). */
export function pageOf<T>(all: T[], wanted: number, size: number): Page<T> {
  const { page, pages } = pageBounds(all.length, wanted, size);
  return { rows: all.slice((page - 1) * size, page * size), total: all.length, page, pages };
}
