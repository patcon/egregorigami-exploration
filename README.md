# egregorigami

Explorations of collective intelligence, narrative space, and protein folding.

A set of in-browser visualizations built with React + TypeScript + Vite, deployed to GitHub Pages.

**Live:** https://patcon.github.io/egregorigami-exploration/

## Views

| Hash | Name | Description |
|------|------|-------------|
| `#v1` | Transcript Window Visualizer | Watch an embedding context window slide through pasted text in real time. Configurable window size, overlap %, and playback duration. |
| `#v2` | YouTube Transcript Visualizer | Paste a YouTube URL and watch the embedding window slide through the synced transcript. |
| `#v3` | Embedding Projector | Generate sentence embeddings in-browser (via HuggingFace Transformers.js) and explore the 3D semantic space with an interactive scatter plot. |
| `#v4` | Embedding Layout | Side-by-side view: YouTube player + transcript + inline 3D embedding panel. |
| `#v5` | Embedding Layout (New Renderers) | Same as v4, with switchable 3D renderers: original points, Cividis tube, and glow shader with bloom. |

## Keyboard shortcuts

Available in all views:

- **Space** — play / pause (video, or cursor animation if no video is loaded)
- **← / →** — seek ±10 seconds in the video; step the cursor one window forward/back in transcript-only view

Shortcuts are suppressed when a text input or textarea has focus.

## Dev setup

```bash
pnpm install
pnpm dev        # start dev server (required for YouTube transcript fetching)
pnpm build      # TypeScript compile + Vite build
pnpm lint       # ESLint
pnpm preview    # preview production build locally

# Extract a transcript to stdout (dev server must be running)
pnpm extract-transcript -- <youtube-url-or-video-id>
```

> **Note:** The `/api/transcript` endpoint only exists in the dev server. The YouTube URL input is hidden in production builds (`import.meta.env.PROD` guard). Load a transcript in dev, and it will be cached in `localStorage` for use in production.

## Tech

- React 19 + TypeScript, built with Vite
- Three.js for 3D rendering (OrbitControls, post-processing bloom)
- `@huggingface/transformers` for in-browser sentence embeddings (`Xenova/all-MiniLM-L6-v2`)
- `umap-js` for 3D dimensionality reduction
- `youtube-transcript-plus` for server-side transcript fetching (dev only)
- Deployed via GitHub Actions to GitHub Pages
