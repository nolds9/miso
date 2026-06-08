// ---------------------------------------------------------------------------
// netscape.ts — parse Netscape cookies.txt → Playwright Cookie[]
// ---------------------------------------------------------------------------

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

const isInstagramDomain = (domain: string): boolean =>
  domain.includes("instagram.com");

/** Parse a Netscape-format cookies file (7- or 11-column variants). */
export const parseNetscapeCookies = (content: string): PlaywrightCookie[] => {
  const cookies: PlaywrightCookie[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;

    const domain = parts[0]!;
    if (!isInstagramDomain(domain)) continue;

    const httpOnlyFlag = parts[1]!.toUpperCase() === "TRUE";
    const path = parts[2]! || "/";
    const secure = parts[3]!.toUpperCase() === "TRUE";
    const expiration = parseInt(parts[4]!, 10);
    const name = parts[5]!;
    const value = parts.slice(6).join("\t"); // value may contain tabs in rare exports

    const cookie: PlaywrightCookie = {
      name,
      value,
      domain: domain.startsWith(".") ? domain : `.${domain}`,
      path,
      httpOnly: httpOnlyFlag,
      secure,
      sameSite: "Lax",
    };

    if (!isNaN(expiration) && expiration > 0) {
      cookie.expires = expiration;
    }

    cookies.push(cookie);
  }

  return cookies;
};

export const toStorageState = (
  cookies: readonly PlaywrightCookie[],
): { cookies: PlaywrightCookie[] } => ({
  cookies: [...cookies],
});

export const validateInstagramCookies = (
  cookies: readonly PlaywrightCookie[],
): { ok: true } | { ok: false; missing: string[] } => {
  const names = new Set(cookies.map((c) => c.name));
  const required = ["sessionid", "csrftoken"];
  const missing = required.filter((n) => !names.has(n));
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
};
