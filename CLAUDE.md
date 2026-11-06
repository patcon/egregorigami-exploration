# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (required for YouTube transcript features)
pnpm build        # TypeScript compile + Vite build
pnpm lint         # ESLint
pnpm preview      # Preview production build locally
pnpm cf:dev       # Build for Cloudflare + run the Worker locally (wrangler dev)
pnpm cf:deploy    # Build for Cloudflare + deploy the Worker

# Extract a transcript to stdout (dev only)
pnpm extract-transcript -- <youtube-url-or-video-id>
```

Use `pnpm` — not `npm`.

## Changelog

Update `CHANGELOG.md` under `## Unreleased` for every user-facing change. Do this in the same commit as the change itself.

## Architecture

Single-page React + TypeScript app built with Vite. Hash-based routing in `App.tsx` dispatches to three views (`#v1`, `#v2`, `#v3`). No router library.

**Views:**
- `#v1` — `TranscriptViewer`: Paste-in text with a sliding embedding context window visualizer. Animates via `requestAnimationFrame`. Supports words/segments window mode and configurable overlap %.
- `#v2` — `YoutubeTranscriptViewer`: Wraps `TranscriptViewer` with a YouTube URL input. Fetches transcript from the local dev server API (`/api/transcript`), then passes text + duration into `TranscriptViewer`.
- `#v3` — `YoutubeEmbeddingProjector`: URL input → loads segments → `SegmentProjectorModal` runs in-browser embeddings via `@huggingface/transformers` (model: `Xenova/all-MiniLM-L6-v2`) → UMAP 3D reduction → `ScatterPlot3D` (Three.js).

**Dev-only API:** The Vite config registers a `/api/transcript` middleware (via `youtube-transcript-plus`) that proxies YouTube transcript fetching server-side. The same handler lives in `server/transcript.ts` and is also served by the Cloudflare Worker (`worker/index.ts`, `wrangler.jsonc`). On the GitHub Pages build the endpoint does **not** exist: `hasTranscriptApi` in `src/env.ts` (true in dev or when built with `VITE_TRANSCRIPT_API=true`) gates the in-app fetch, and views fall back to linking out to youtube-transcript.io.

**Key data flow for #v3:**
1. `YoutubeEmbeddingProjector` fetches segments → stores in `localStorage` (`yt-segments`)
2. `SegmentProjectorModal` reads from `localStorage`, calls `embedSegments.ts` → `runUmap.ts`
3. `embedSegments.ts` lazy-loads the HuggingFace pipeline (singleton `pipelineInstance`) and embeds each segment sequentially
4. `runUmap.ts` runs UMAP with `nComponents: 3`
5. `ScatterPlot3D` renders the 3D scatter using Three.js

**localStorage keys:** `yt-url`, `yt-transcript`, `yt-duration`, `yt-video-id`, `yt-segments`, `transcript-text`, `transcript-duration`

**Deployment:** Two targets, each with its own workflow:
- GitHub Pages at `/egregorigami-exploration/` (`deploy.yml`, default `base` in `vite.config.ts`). Static only, no transcript API.
- Cloudflare Workers at `/` (`deploy-cloudflare.yml`, `pnpm build:cf` sets `VITE_BASE=/` and `VITE_TRANSCRIPT_API=true`). Needs the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. YouTube bot-blocks Cloudflare IPs, so the Worker fetches via Supadata (`SUPADATA_API_KEY` Worker secret; `.env` for `wrangler dev`) and caches successful transcripts forever in KV (`TRANSCRIPTS` binding, namespace `egregorigami-exploration-transcripts`, key `transcript:v1:<videoId>`; bump `CACHE_VERSION` in `worker/index.ts` to invalidate). The KV binding is `"remote": true`, so `pnpm cf:dev` reads and writes the **production** cache too. Be sparing when testing — each uncached fetch costs a Supadata credit.
