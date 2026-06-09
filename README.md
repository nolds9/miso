# Miso

Extract recipes from your Instagram **Saved** reels and write them as structured pages in a Notion recipe database.

Miso reads a local Instagram data export (`saved_posts.json`), classifies each reel, extracts structured recipe data with an LLM, and syncs new recipes to Notion. Re-runs are idempotent — already-imported reels are skipped by URL.

## How it works

```
saved_posts.json → normalize → dedupe → gate + extract → (optional enrich) → Notion
```

1. **Read export** — parse Instagram's "Download Your Information" JSON (no live scraping in the default path).
2. **Normalize** — repair mojibake captions, extract URL, hashtags, creator, and saved date.
3. **Dedupe** — skip reels whose source URL already exists in Notion.
4. **Gate + extract** — classify whether a reel is a recipe; extract name, ingredients, steps, cuisine, meal type, and more.
5. **Enrich (optional)** — for incomplete recipes, fetch the first/pinned Instagram comment via Playwright and re-extract.
6. **Write** — create one Notion page per recipe with properties and body blocks.

For architecture details, domain models, and design decisions, see [architecture.md](./architecture.md).

## Prerequisites

- **Node.js** 18+ and **pnpm**
- A **Notion** integration with access to your Recipes database
- A **Nous Portal** API key ([portal.nousresearch.com](https://portal.nousresearch.com))
- An Instagram **data export** containing saved posts (`saved_posts.json`)

Optional (Tier-1 comment enrichment):

- Instagram session cookies (Netscape `cookies.txt` or manual Playwright login)
- Playwright Chromium (installed automatically via `postinstall`)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `NOTION_API_TOKEN` | Notion integration token (`ntn_…`) |
| `NOTION_DATABASE_ID` | Recipes database ID |
| `NOTION_DATA_SOURCE_ID` | Data source ID for dedup queries |
| `NOUS_API_KEY` | Nous Portal API key |

### 3. Add your Instagram export

Request a data download from Instagram (**Settings → Accounts Center → Your information and permissions → Download your information**). Choose JSON format and include saved posts.

Place the resulting `saved_posts.json` in the project root (or set a custom path — the default is `./saved_posts.json`).

> `saved_posts.json` is gitignored. Do not commit it.

## Usage

### Full pipeline

Extract recipes and write new ones to Notion:

```bash
pnpm run
```

### Dry run

Run extraction without writing to Notion:

```bash
pnpm run --dry
```

### Census

Classify the export and print a distribution report — no LLM writes, no Notion writes:

```bash
pnpm census
```

### Verbose output

Log per-reel outcomes and show the full partial-reel list in the report:

```bash
pnpm run -- --verbose
```

Each run prints a summary: totals, duplicates skipped, recipes written, partial/failed counts, extraction tiers, and cuisine/meal-type tallies.

## Optional: Tier-1 comment enrichment

When a caption looks like a recipe but is incomplete (e.g. "comment RECIPE for ingredients"), Miso can fetch the reel's first or pinned comment from Instagram and re-extract.

See [docs/tier1-playwright-enrichment.md](./docs/tier1-playwright-enrichment.md) for full details.

### Enable enrichment

1. Set `ENRICH_ENABLED=true` in `.env`.

2. Provide Instagram auth via one of:

   **Netscape cookies (recommended):**

   ```bash
   # Export cookies.txt from your browser, then:
   IG_COOKIES_PATH=./cookies.txt pnpm run ig:import-cookies
   ```

   **Manual login:**

   ```bash
   pnpm run ig:login
   ```

3. Probe that auth works:

   ```bash
   pnpm run ig:probe
   ```

Auth state is stored at `~/.miso/ig-storage.json` by default (gitignored).

## Configuration

All tunables live in `.env`. Common options:

| Variable | Default | Description |
|----------|---------|-------------|
| `CONCURRENCY_EXTRACT` | `4` | Parallel extract + write pool |
| `CONCURRENCY_WRITE` | `3` | Notion write concurrency (~3 req/s ceiling) |
| `ESCALATION_CAP` | `1` | Max enrichment passes per reel |
| `ENRICH_ENABLED` | `false` | Enable Tier-1 comment fetching |
| `CONCURRENCY_ENRICH` | `2` | Parallel Playwright comment fetches |
| `ENRICH_HEADLESS` | `true` | Run browser headless |
| `DRY_RUN` | `false` | Skip Notion writes (also available as CLI flag) |
| `VERBOSE` | `false` | Per-reel logging (also available as CLI flag) |

## Project structure

```
src/
  run.ts              # CLI entrypoint
  pipeline.ts         # Composed pipeline (ports injected)
  ports.ts            # Port interfaces and domain types
  transforms.ts       # Pure normalizeReel (incl. mojibake repair)
  notion.ts           # Notion read/write adapters
  config.ts           # Env-based configuration
  domains/recipe.ts   # Heuristic gate + LLM extraction
  enrich/             # Tier-1 Playwright comment enrichment

scripts/
  ig-import-cookies.ts
  ig-login.ts
  ig-probe.ts

docs/
  tier1-playwright-enrichment.md

architecture.md       # Full architecture & requirements
```

## Development

```bash
# Type check
pnpm typecheck

# Run tests
pnpm test
```

Tests cover mojibake repair, comment parsing, enrichment heuristics, and other pure transforms.

## Models

Extraction runs through [Nous Portal](https://portal.nousresearch.com):

- **Tier-0** — `google/gemini-3-flash-preview` (caption-only, fast and cheap)
- **Tier-2** — `anthropic/claude-sonnet-4.6` (escalation with richer context)

A single `NOUS_API_KEY` covers both tiers.

## License

ISC
