// ---------------------------------------------------------------------------
// storage.ts — load Playwright storageState and validate session cookies
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlaywrightCookie } from "./netscape.ts";
import { validateInstagramCookies } from "./netscape.ts";
import { EnrichError } from "./types.ts";

export type StorageState = {
  readonly cookies: readonly PlaywrightCookie[];
};

export const loadStorageState = async (path: string): Promise<StorageState> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new EnrichError("storage_missing", `Storage file not found: ${path}`);
  }

  const parsed = JSON.parse(raw) as { cookies?: PlaywrightCookie[] };
  const cookies = parsed.cookies ?? [];
  const check = validateInstagramCookies(cookies);
  if (!check.ok) {
    throw new EnrichError(
      "storage_missing",
      `ig-storage.json missing required cookies: ${check.missing.join(", ")}`,
    );
  }

  return { cookies };
};

/** Write storage JSON with restrictive permissions (best-effort on all platforms). */
export const writeStorageState = async (
  path: string,
  state: { cookies: readonly PlaywrightCookie[] },
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows may not support chmod the same way
  }
};
