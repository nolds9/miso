// ---------------------------------------------------------------------------
// cache.ts — disk cache for fetched comments (keyed by reelId)
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { CachedComment, CommentSource } from "./types.ts";

const cachePath = (dir: string, reelId: string): string =>
  join(dir, `${reelId}.json`);

export const readCachedComment = async (
  dir: string,
  reelId: string,
  ttlDays: number,
): Promise<CachedComment | null> => {
  const path = cachePath(dir, reelId);
  try {
    await access(path);
  } catch {
    return null;
  }

  try {
    const raw = await readFile(path, "utf8");
    const entry = JSON.parse(raw) as CachedComment;
    if (ttlDays > 0) {
      const ageMs = Date.now() - new Date(entry.fetchedAt).getTime();
      const maxMs = ttlDays * 24 * 60 * 60 * 1000;
      if (ageMs > maxMs) return null;
    }
    return entry;
  } catch {
    return null;
  }
};

export const writeCachedComment = async (
  dir: string,
  entry: CachedComment,
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  const path = cachePath(dir, entry.reelId);
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
};

export const cachedToResult = (
  entry: CachedComment,
): { text: string; source: CommentSource } => ({
  text: entry.firstComment,
  source: entry.source,
});
