# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (required for YouTube transcript features)
pnpm build        # TypeScript compile + Vite build
pnpm lint         # ESLint
pnpm preview      # Preview production build locally

# Extract a transcript to stdout (dev only)
pnpm extract-transcript -- <youtube-url-or-video-id>
```

Use `pnpm` — not `npm`.

## Architecture

Single-page React + TypeScript app built with Vite. Hash-based routing in `App.tsx` dispatches to three views (`#v1`, `#v2`, `#v3`). No router library.

**Views:**
- `#v1` — `TranscriptViewer`: Paste-in text with a sliding embedding context window visualizer. Animates via `requestAnimationFrame`. Supports words/segments window mode and configurable overlap %.
- `#v2` — `YoutubeTranscriptViewer`: Wraps `TranscriptViewer` with a YouTube URL input. Fetches transcript from the local dev server API (`/api/transcript`), then passes text + duration into `TranscriptViewer`.
- `#v3` — `YoutubeEmbeddingProjector`: URL input → loads segments → `SegmentProjectorModal` runs in-browser embeddings via `@huggingface/transformers` (model: `Xenova/all-MiniLM-L6-v2`) → UMAP 3D reduction → `ScatterPlot3D` (Three.js).

**Dev-only API:** The Vite config registers a `/api/transcript` middleware (via `youtube-transcript-plus`) that proxies YouTube transcript fetching server-side. This endpoint does **not** exist in production builds — `import.meta.env.PROD` guards disable the URL input when deployed.

**Key data flow for #v3:**
1. `YoutubeEmbeddingProjector` fetches segments → stores in `localStorage` (`yt-segments`)
2. `SegmentProjectorModal` reads from `localStorage`, calls `embedSegments.ts` → `runUmap.ts`
3. `embedSegments.ts` lazy-loads the HuggingFace pipeline (singleton `pipelineInstance`) and embeds each segment sequentially
4. `runUmap.ts` runs UMAP with `nComponents: 3`
5. `ScatterPlot3D` renders the 3D scatter using Three.js

**localStorage keys:** `yt-url`, `yt-transcript`, `yt-duration`, `yt-video-id`, `yt-segments`, `transcript-text`, `transcript-duration`

**Deployment:** GitHub Pages at `/egregorigami-exploration/` (configured in `vite.config.ts` `base`).
