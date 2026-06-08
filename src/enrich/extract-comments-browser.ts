// ---------------------------------------------------------------------------
// Browser-side comment extraction for page.evaluate (must stay a plain string).
// ---------------------------------------------------------------------------

/** Serialized: (handle, caption) => CommentCandidate[] */
export const EXTRACT_COMMENTS_BROWSER_FN = `(handle, caption) => {
  const norm = (s) => s.replace(/\\s+/g, " ").trim();
  const owner = (handle || "").replace(/^@/, "").toLowerCase();
  const captionNorm = norm(caption || "");
  const candidates = [];
  const seen = new Set();

  const recipeSignal = /\\b(ingredients?|instructions?|steps?|recipe|tbsp|tsp|cup|cups|oz|grams?|ml|preheat|bake|\\d+\\s*(tbsp|tsp|cup|oz|lb|g|kg|ml))\\b/i;

  const isNoise = (text) => {
    if (!text || text.length < 8) return true;
    if (/^(reply|view|more|follow|like|share|save|comments?|likes?|views?)$/i.test(text)) return true;
    if (/^(Mix:|Original audio)/i.test(text)) return true;
    if (/\\b(instrumental|official audio)\\b/i.test(text)) return true;
    if (captionNorm && text === captionNorm) return true;
    if (captionNorm && captionNorm.length > 40 && text.length > 40 && captionNorm.includes(text.slice(0, 40))) return true;

    const bullets = (text.match(/\\s•\\s/g) || []).length;
    const pipes = (text.match(/\\s\\|\\s/g) || []).length;
    if (!recipeSignal.test(text)) {
      if (bullets >= 2 || (bullets >= 1 && pipes >= 1)) return true;
      if (text.length < 120 && text.includes("•")) {
        const parts = text.split(/\\s*•\\s*/);
        if (parts.length === 2 && parts[0].length < 70 && parts[1].length < 70) return true;
      }
    }
    return false;
  };

  const inAudioStrip = (el) => {
    if (!el) return false;
    return !!el.closest('a[href*="/reels/audio"], a[href*="audio"], [aria-label*="Audio"], [aria-label*="audio"]');
  };

  const profileHref = (href) => {
    if (!href) return null;
    const m = href.match(/instagram\\.com\\/([^/?]+)/) || href.match(/^\\/([a-z0-9._]+)\\/?$/i);
    if (!m || !m[1]) return null;
    const u = m[1].toLowerCase();
    if (["p", "reel", "reels", "explore", "accounts", "stories", "direct"].includes(u)) return null;
    return u;
  };

  const pushCandidate = (text, author, source, isPinned) => {
    if (!text || seen.has(text) || isNoise(text)) return;
    seen.add(text);
    const entry = { text, source: source || "top" };
    if (author) entry.author = author;
    if (isPinned) entry.isPinned = true;
    candidates.push(entry);
  };

  const textFromCommentLi = (li) => {
    if (inAudioStrip(li)) return;
    const spans = li.querySelectorAll('span[dir="auto"]');
    let best = "";
    let author;
    for (const a of li.querySelectorAll('a[href]')) {
      const u = profileHref(a.getAttribute("href") || "");
      if (u) { author = u; break; }
    }
    for (const span of spans) {
      if (inAudioStrip(span)) continue;
      const t = norm(span.textContent || "");
      if (t.length > best.length) best = t;
    }
    if (!best) return;
    const source = author === owner ? "owner" : "top";
    pushCandidate(best, author, source, false);
  };

  // Pinned comments
  const pinnedLabels = Array.from(document.querySelectorAll("span, div"))
    .filter((el) => /^pinned$/i.test(norm(el.textContent || "")));

  for (const label of pinnedLabels.slice(0, 3)) {
    const li = label.closest("li");
    if (li) {
      textFromCommentLi(li);
      const pinned = candidates[candidates.length - 1];
      if (pinned) {
        pinned.source = "pinned";
        pinned.isPinned = true;
      }
      continue;
    }
    let node = label.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      const spans = node.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        const text = norm(span.textContent || "");
        if (text.length > 20 && !/^pinned$/i.test(text)) {
          pushCandidate(text, owner || undefined, "pinned", true);
          break;
        }
      }
      node = node.parentElement;
    }
  }

  // Prefer comment list items (dialog sheet or inline thread)
  const listRoots = [
    document.querySelector('[role="dialog"]'),
    document.querySelector("section"),
    document.querySelector("article"),
  ].filter(Boolean);

  for (const root of listRoots) {
    const items = root.querySelectorAll("ul li");
    for (const li of items) {
      if (li.querySelector('a[href*="/reels/audio"]')) continue;
      const hasProfile = !!li.querySelector('a[href^="/"], a[href*="instagram.com/"]');
      if (!hasProfile) continue;
      textFromCommentLi(li);
    }
  }

  return candidates.slice(0, 40);
}`;
