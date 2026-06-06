# organize

AI-powered CLI that **looks at your screenshots**, describes them, renames them descriptively, and sorts them into folders — using the vision model of your choice: Anthropic, OpenAI, Google, or a **fully local model via Ollama / LM Studio**.

Every image it analyzes becomes **searchable**: `organize find "stripe invoice"` finds that screenshot you took months ago, instantly, with zero API calls.

```
Before                                    After
──────                                    ─────
Screenshot 2026-02-12 at 5.30.28 PM.png   Organized/
Screenshot 2026-02-13 at 12.32.06 PM.png  ├── Code & Terminal/
Screenshot 2026-02-15 at 4.36.43 PM.png   │   └── vite-build-error-stack-trace.png
... ×282                                  ├── Receipts/
                                          │   └── stripe-invoice-march-2026.png
                                          └── Chats & Messages/
                                              └── slack-thread-deploy-incident.png
```

## Install

**Standalone binary** — no Node or Bun required. Download the one for your platform from [Releases](https://github.com/zachkamran/organize/releases/latest), then:

```bash
chmod +x organize-* && mv organize-* /usr/local/bin/organize
```

| Platform | Binary |
|---|---|
| macOS (Apple Silicon) | `organize-darwin-arm64` |
| macOS (Intel) | `organize-darwin-x64` |
| Linux (x64 / arm64) | `organize-linux-x64` / `organize-linux-arm64` |
| Windows | `organize-windows-x64.exe` |

**From source:**

```bash
git clone https://github.com/zachkamran/organize && cd organize
bun install && bun run build && bun link
```

## Quick start

```bash
# 1. Store your API key securely (macOS Keychain — never touches disk or history)
organize auth anthropic
#    ...or just use an env var: export ANTHROPIC_API_KEY=...

# 2. Preview what it would do (analyses are cached — previewing is never wasted money)
organize ~/Desktop --dry-run

# 3. Do it (reuses the cached analyses, asks for confirmation first)
organize ~/Desktop
```

## Find anything you've ever screenshotted

```bash
organize index ~/Pictures/Screenshots --include-subdirs   # analyze once, move nothing
organize find "salary table"                              # instant — searches local cache
organize find "that error about the database connection"
```

`index` analyzes and caches without reorganizing — ideal for big libraries. `find` searches descriptions, AI filenames, and categories. For fuzzier matching, enable semantic search:

```bash
organize index ~/Pictures/Screenshots --embed   # embeds descriptions (~$0.02/1M tokens)
organize find "revenue going up"                # now matches by meaning, not just words
```

### True image embeddings

Text embeddings match the AI's one-line *description*. With a **multimodal** embedding model, the image itself is embedded — so visual qualities nobody wrote down ("dark mode", "blue dashboard", "handwritten") become searchable:

```bash
organize auth voyage                                          # voyageai.com key (free tier)
organize config set embeddingModel voyage/voyage-multimodal-3
organize index ~/Pictures/Screenshots --embed                 # embeds the pixels
organize find "dark dashboard with a big blue area chart" --preview
```

Note: OpenAI's `text-embedding-3-*` models are text-only and cannot embed images — multimodal embeddings need Voyage (`voyage-multimodal-3`) or similar.

Text embedding models are configurable too — `openai/text-embedding-3-small` (default) or fully local `ollama/nomic-embed-text`.

## Undo

```bash
organize undo   # puts every file from the last run back where it came from
```

## How it works

1. **Scan** — finds images (`png`, `jpg`, `jpeg`, `webp`, `gif`, `heic`, `tiff`) in the directory (`--include-subdirs` to recurse). HEIC (iPhone) is converted on the fly on macOS; symlinks and fake/corrupt images are skipped. **Exact duplicates** (byte-identical) are routed to a `Duplicates/` folder; visually-similar near-duplicates are reported.
2. **Analyze** — each image is sent to the model, which returns a structured `{category, description, filename}`. Categories are **auto-discovered**: the model invents broad ones and is told to reuse categories already seen, then a final consolidation pass merges near-duplicates.
3. **Plan** — you see every proposed move (`old-name → Category/new-name`) before anything happens.
4. **Move** — files land in `<dir>/Organized/<Category>/` with descriptive kebab-case names. Collisions get `-2`, `-3` suffixes.

Every analysis is cached by file content hash (`~/.cache/organize/`), so a `--dry-run` followed by a real run analyzes nothing twice, and re-runs after failures only pay for the missing files.

## Steer it with instructions

One-off, per run:

```bash
organize ~/Desktop --prompt "anything with code goes in 'Work', be funny with meme filenames"
```

Persistent, for every run:

```bash
organize config set instructions "I'm a designer — split UI screenshots by app name"
```

### Example: SOC 2 evidence collection

Taking screenshots as compliance evidence? Pin the categories and tell it the context:

```bash
organize ./evidence \
  --categories "Security,Availability,Processing Integrity,Confidentiality,Privacy" \
  --prompt "These are SOC 2 audit evidence screenshots. Categorize by Trust Services
            Criteria and name files as <control>-<system>-<what-it-shows>."
```

Pinned categories (via `--categories` or config) are preferred by the model but not a closed list — it can still create a new category if something truly doesn't fit.

## Models & providers

Default is `anthropic/claude-haiku-4-5` — fast and cheap, plenty for screenshot classification. Use any vision-capable model:

```bash
organize ~/Desktop --model anthropic/claude-opus-4-8    # maximum quality
organize ~/Desktop --model openai/gpt-5.2
organize ~/Desktop --model google/gemini-3-pro
organize config set model anthropic/claude-opus-4-8     # change the default
```

### Local models — free and private

Run entirely on your machine with [Ollama](https://ollama.com) or LM Studio — no API key, no cost, images never leave your computer:

```bash
ollama pull qwen3-vl                       # any vision-capable model
organize ~/Desktop --model ollama/qwen3-vl
organize ~/Desktop --model lmstudio/qwen3-vl
```

Endpoints default to `localhost:11434` / `localhost:1234`; override with `OLLAMA_BASE_URL` / `LMSTUDIO_BASE_URL`.

API keys for cloud providers are resolved per provider: env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) first, then the macOS Keychain (`organize auth <provider>`).

## All options

```
organize [dir]                    default: current directory
  --dry-run                       show the plan, move nothing
  -y, --yes                       skip confirmation
  --out <dir>                     destination root (default: <dir>/Organized)
  --model <id>                    provider/model
  --prompt <text>                 extra instructions for this run
  --categories <a,b,c>            pinned categories the AI should prefer
  --include-subdirs               recurse into subdirectories
  --no-rename                     keep original filenames
  --copy                          copy instead of move
  --concurrency <n>               parallel API calls (default 5)
  --no-cache                      force fresh analysis

organize undo                     revert the last run
organize find <query>             search analyzed images (--limit, --all, --keyword)
organize index [dir]              make images searchable without moving (--embed for semantic)
organize auth [provider]          store a key in the macOS Keychain
organize config [show|get|set|path]
organize cache clear
```

## Config file

`~/.config/organize/config.json` (CLI flags always win):

```json
{
  "model": "anthropic/claude-haiku-4-5",
  "rename": true,
  "instructions": "",
  "categories": [],
  "concurrency": 5,
  "embeddingModel": "openai/text-embedding-3-small"
}
```

## Cost

Live cost shows in the progress line and a summary prints after every run (prices via the LiteLLM catalog). Ballpark per image: ~$0.001–0.003 on Haiku 4.5 (default), ~10× that on Opus 4.8, **$0.00 on a local Ollama model**. A 280-screenshot desktop is well under a dollar on Haiku. Analyses are cached by content hash, so dry runs, re-runs, and `find` cost nothing extra.

## License

MIT
