// ---------------------------------------------------------------------------
// selectors.ts — Instagram DOM selectors (update here when IG changes layout)
// ---------------------------------------------------------------------------

export const SELECTORS = {
  loginWall: [
    'input[name="username"]',
    'a[href*="/accounts/login"]',
    'text=Log in',
  ],
  dismissOverlays: [
    'button:has-text("Not Now")',
    'button:has-text("Not now")',
    'div[role="dialog"] button:has-text("Not Now")',
  ],
  pinnedComment: [
    'span:has-text("Pinned")',
    'div:has-text("Pinned")',
  ],
  commentList: [
    'ul ul li',
    'article ul li',
    'div[role="button"] + div ul li',
  ],
  openComments: [
    '[aria-label="Comment"]',
    '[aria-label="Comments"]',
    'svg[aria-label="Comment"]',
    'a[href*="/comments/"]',
    'span:has-text("View all comments")',
    'span:has-text("View comments")',
  ],
  loadMoreComments: [
    'button:has-text("View more comments")',
    'span:has-text("View more comments")',
    'button:has-text("View all")',
  ],
  commentThread: [
    '[role="dialog"] ul li',
    'article ul li',
    'section ul li',
  ],
} as const;

export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export const VIEWPORT = { width: 390, height: 844 } as const;
