import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  parseNetscapeCookies,
  validateInstagramCookies,
} from "./netscape.ts";

describe("parseNetscapeCookies", () => {
  it("parses project cookies.txt fixture", async () => {
    const path = resolve(process.cwd(), "cookies.txt");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      // cookies.txt is gitignored — use inline fixture
      raw = [
        "# Netscape HTTP Cookie File",
        ".instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc123",
        ".instagram.com\tTRUE\t/\tTRUE\t1815166791\tcsrftoken\tdef456",
        ".example.com\tTRUE\t/\tFALSE\t0\tother\tignored",
      ].join("\n");
    }

    const cookies = parseNetscapeCookies(raw);
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.every((c) => c.domain.includes("instagram.com"))).toBe(true);

    const names = new Set(cookies.map((c) => c.name));
    if (names.has("sessionid")) {
      const session = cookies.find((c) => c.name === "sessionid");
      expect(session?.httpOnly).toBe(true);
      expect(session?.domain).toMatch(/^\.instagram\.com$/);
    }
  });

  it("validateInstagramCookies requires sessionid and csrftoken", () => {
    expect(
      validateInstagramCookies([
        {
          name: "sessionid",
          value: "x",
          domain: ".instagram.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "csrftoken",
          value: "y",
          domain: ".instagram.com",
          path: "/",
          httpOnly: false,
          secure: true,
          sameSite: "Lax",
        },
      ]).ok,
    ).toBe(true);

    expect(
      validateInstagramCookies([
        {
          name: "csrftoken",
          value: "y",
          domain: ".instagram.com",
          path: "/",
          httpOnly: false,
          secure: true,
          sameSite: "Lax",
        },
      ]).ok,
    ).toBe(false);
  });
});
