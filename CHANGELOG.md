# Changelog

All notable changes to this project are documented here. Versions follow [SemVer](https://semver.org/); the format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.1] - 2026-06-06

### Added
- **`organize watch`** — keep the search index fresh automatically. Foreground mode (`organize watch ~/Desktop --embed`) re-indexes on file changes with a debounce; on macOS, `--install` sets up a launchd agent that runs in the background and survives reboots (`--uninstall` to remove). Keys must be in the Keychain (`organize auth`) since launchd doesn't read shell env.
- **OpenRouter embeddings** — `embeddingModel openrouter/<model>` works for text models and, for image embeddings, `openrouter/google/gemini-embedding-2` and `openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free` (free). One OpenRouter key now covers vision analysis *and* visual search.

### Fixed
- `--include-subdirs` (and other flags shared with the root command) were silently swallowed when used with subcommands like `index`.
- Recursive scans no longer descend into `node_modules` or macOS bundles (`.app`, `.photoslibrary`, `.framework`).

## [0.3.0] - 2026-06-05

### Added
- **Inline image previews** — `organize find <query> --preview` renders thumbnails directly in the terminal: Kitty graphics protocol (Ghostty, Kitty), iTerm2 inline images, and a 24-bit-color ANSI fallback everywhere else.
- **True image embeddings** — set `embeddingModel` to `voyage/voyage-multimodal-3` and `organize index --embed` embeds the *image pixels* instead of the description, making visual qualities ("dark mode", "blue dashboard") searchable. Text queries share the same vector space. `organize auth voyage` / `VOYAGE_API_KEY`.
- **OpenRouter provider** — `--model openrouter/<vendor>/<model>` runs any vision model on openrouter.ai with a single key (`organize auth openrouter` / `OPENROUTER_API_KEY`). Chat/vision only — OpenRouter has no embeddings endpoint.
- **Update notifier** — a quiet hint when a newer release exists (checked at most daily, 1.5s timeout, silent offline; disable with `ORGANIZE_NO_UPDATE_CHECK=1`).

## [0.2.0] - 2026-06-05

### Added
- **`organize undo`** — every run writes a manifest; `undo` puts all files back where they came from (deletes copies for `--copy` runs). Partial failures keep the manifest so you can retry.
- **`organize find <query>`** — instant search over every image you've analyzed, straight from the local cache. Zero API calls. `--limit`, `--all`, `--keyword`.
- **`organize index [dir]`** — analyze and cache images *without moving anything*: build a searchable index over a large library. `--embed` computes description embeddings for semantic search ("revenue going up" matches a chart).
- **Local models** — `--model ollama/qwen3-vl` or `lmstudio/<model>` run fully on your machine: free, private, no API key. Endpoints configurable via `OLLAMA_BASE_URL` / `LMSTUDIO_BASE_URL`.
- **Duplicate detection** — byte-identical files are automatically routed to a `Duplicates/` folder; visually-similar near-duplicates (perceptual hash) are reported for review.
- **HEIC & TIFF support** — iPhone HEIC screenshots convert on the fly via macOS `sips`; TIFF decodes via jimp.
- **`--include-subdirs`** — recursive scanning (the output folder is never re-scanned).
- Configurable `embeddingModel` (default `openai/text-embedding-3-small`; local `ollama/nomic-embed-text` works too).

### Changed
- Default model is now `anthropic/claude-haiku-4-5` (~10× cheaper than Opus and plenty accurate for screenshot classification). Set `organize config set model …` to change.
- Analysis cache cap raised from 5,000 to 50,000 entries for large libraries.

## [0.1.2] - 2026-06-05

### Added
- **Live cost tracking** — running dollar cost in the progress line and a tokens + cost summary at the end of every run. Prices come from the LiteLLM community catalog (fetched daily, cached locally, built-in fallback when offline).

## [0.1.1] - 2026-06-05

### Fixed
- `--concurrency` with a non-numeric/zero/negative value crashed the worker pool; now validated with a clear error.
- Cache was only saved at the very end of a run and non-atomically — an interrupted run lost every analysis it had paid for. Now saved incrementally (debounced) and written atomically; capped with oldest-first eviction.
- The first `concurrency` images all saw an empty category list, undermining category reuse. The first image is now analyzed alone to seed the shared vocabulary.
- Symlinks were followed, which could read and copy files outside the target directory. Now skipped with a notice.
- A file created at the destination between planning and execution could be silently overwritten. Moves/copies are now strictly no-overwrite (`COPYFILE_EXCL`) with automatic `-2`/`-3` re-suffixing.
- Renamed/corrupt non-images (e.g. a text file with a `.png` extension) wasted an API call; magic bytes are now sniffed first.
- Missing API key was reported only after scanning; now checked up front.
- Windows display paths used `/`; failure progress ticks were delayed to the end of the run.

## [0.1.0] - 2026-06-05

### Added
- Initial release: AI-powered screenshot organizer CLI.
- Vision analysis via the Vercel AI SDK — Anthropic (default), OpenAI, and Google models with structured output.
- Auto-discovered categories with a consolidation pass to merge near-duplicate category names; pinned categories via `--categories`/config.
- Descriptive kebab-case renaming (`--no-rename` to keep names).
- Content-hash analysis cache: dry-run → apply re-analyzes nothing; interrupted runs resume free.
- Custom instructions via persistent config and per-run `--prompt`.
- Safe by default: full move plan + confirmation before touching files; collision-safe naming.
- API keys via env vars or the macOS Keychain (`organize auth`).
- In-memory downscaling for oversized images (originals never modified).
- Standalone binaries for macOS/Linux/Windows via GitHub Releases.

[0.3.1]: https://github.com/zachkamran/organize/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/zachkamran/organize/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zachkamran/organize/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/zachkamran/organize/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/zachkamran/organize/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/zachkamran/organize/releases/tag/v0.1.0
