# organize

AI-powered CLI that **looks at your screenshots**, describes them, renames them descriptively, and sorts them into folders — using the vision model of your choice (Anthropic, OpenAI, or Google).

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

```bash
npm install -g organize-ai
```

> Or run without installing: `bunx organize-ai` / `npx organize-ai`

<details>
<summary><strong>Standalone binary</strong> — no Node or Bun required</summary>

Download the binary for your platform from [Releases](https://github.com/zachkamran/organize/releases/latest), then:

```bash
chmod +x organize-* && mv organize-* /usr/local/bin/organize
```

| Platform | Binary |
|---|---|
| macOS (Apple Silicon) | `organize-darwin-arm64` |
| macOS (Intel) | `organize-darwin-x64` |
| Linux (x64 / arm64) | `organize-linux-x64` / `organize-linux-arm64` |
| Windows | `organize-windows-x64.exe` |

</details>

<details>
<summary><strong>From source</strong></summary>

```bash
git clone https://github.com/zachkamran/organize && cd organize
bun install && bun run build && bun link
```

</details>

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

## How it works

1. **Scan** — finds images (`png`, `jpg`, `jpeg`, `webp`, `gif`) in the directory.
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

Default is `anthropic/claude-opus-4-8`. Use any vision-capable model:

```bash
organize ~/Desktop --model anthropic/claude-haiku-4-5   # cheapest
organize ~/Desktop --model openai/gpt-5.2
organize ~/Desktop --model google/gemini-3-pro
organize config set model anthropic/claude-haiku-4-5    # make it the default
```

API keys are resolved per provider: env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) first, then the macOS Keychain (`organize auth <provider>`).

## All options

```
organize [dir]                    default: current directory
  --dry-run                       show the plan, move nothing
  -y, --yes                       skip confirmation
  --out <dir>                     destination root (default: <dir>/Organized)
  --model <id>                    provider/model
  --prompt <text>                 extra instructions for this run
  --categories <a,b,c>            pinned categories the AI should prefer
  --no-rename                     keep original filenames
  --copy                          copy instead of move
  --concurrency <n>               parallel API calls (default 5)
  --no-cache                      force fresh analysis

organize auth [provider]          store a key in the macOS Keychain
organize config [show|get|set|path]
organize cache clear
```

## Config file

`~/.config/organize/config.json` (CLI flags always win):

```json
{
  "model": "anthropic/claude-opus-4-8",
  "rename": true,
  "instructions": "",
  "categories": [],
  "concurrency": 5
}
```

## Cost

Roughly $0.005–0.02 per image with Opus 4.8, ~10× less with Haiku 4.5. A 280-screenshot desktop is a few dollars on Opus, well under a dollar on Haiku. Dry runs are cached, so experimenting with the move plan costs nothing extra.

## License

MIT
