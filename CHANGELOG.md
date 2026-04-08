# Changelog

## Unreleased

- v7 landscape layout: at 640px+ screen width (mobile landscape), the main panel splits into two columns — video on the left, full tab section (Raw, Windowed, Segments, 3D) on the right

- Store embedding model ID and segment count alongside cached 3D points in localStorage — displayed as a small info overlay in the bottom-right corner of the scatter plot
- Rename "Reset Viz" to "Rerun Viz" in v7 — clicking it shows the model selector and Visualize button with an ✕ to return to the visualization without re-embedding; the prior scatter plot remains visible throughout
- Keep prior scatter plot visible while a new embedding runs or is cancelled — cancelling mid-progress restores the previous visualization

- Add URL history autocomplete dropdown to YouTube URL inputs across all embedding views (v3–v7) — shows video title (fetched async via YouTube oEmbed) and URL; title appears above URL in the list but selecting an entry sets only the URL value; history persists in localStorage (`yt-url-history`, max 15 entries)

- Cache 3D UMAP points in localStorage keyed by video ID (`yt-3d-points-<videoId>`) across all embedding views (v3–v7) — points are restored automatically on page reload, and overwritten when a new embedding is run for the same video

- Fix v7 mobile: prevent pull-to-refresh and iOS bounce — lock `html` overflow on mount, add `overscroll-y-contain` to inner scrollable areas (word display, segments list) so their overscroll doesn't propagate, use `100dvh` for dynamic viewport height, and add `flex-shrink-0` to YouTube player wrapper

- Fix 3D scatter not rendering in v7 after deferred-init fix — `extraTabContent` wrapper in TranscriptViewer was missing `flex flex-col`, causing `h-full` on the mount div to resolve to zero

- Fix WebGL "zero size framebuffer" errors in ScatterPlot3D, ScatterPlot3DV5, and ScatterPlot3DV6 when component mounts inside a hidden tab — defer Three.js renderer init until container has non-zero dimensions, using a one-shot ResizeObserver

- Add info button (ⓘ) to v7 URL bar that opens a modal; modal contains a "Version Index →" link, replacing the fixed bottom-left link on that view.
- Add v7: mobile-optimized copy of v5, now the default landing page. Single-column layout on mobile (≤768px). Removes "allow faster" checkbox — video embed hides automatically when speed exceeds 2×. Removes "segments" window mode (words-only). Share URL updated to `#v7`.
- Warn in v7 (below video, above transcript) when transcript duration doesn't match the YouTube video duration (threshold: >10s or >5%). "Fetch Transcript" button moved into transcript section as "Load", alongside a "Transcript" section header.

- Fix all ESLint warnings and errors: move ref writes out of render into effects, type `progress_callback` params, fix recursive rAF `tick` pattern in `SegmentProjectorModal`, and suppress intentional rule violations with targeted disable comments

- Migrate styling from hand-written CSS files to Tailwind CSS v4; all 8 component CSS files replaced with utility classes in JSX; animations, `color-mix()` rules, and pseudo-element styles retained in `index.css`

- Fix white screen when invalid YouTube URL is entered (e.g. `?v=bad`) — `extractVideoId` now validates the 11-char video ID format for YouTube URL inputs, not just raw strings

- Make v5 the default landing page; index nav moved to `#index` (also accessible via "Version Index" link on all pages)
- Sync `?videoId=` querystring in real time as YouTube URL is typed into any view (v2, v3, v4, v5)
- Add download button for 3D embedding points (v3 modal + v5 inline panel) — exports `embeddings-3d.json` once embeddings are complete

## Prior work (selected)

- Add cancel button to embedding progress bar
- Move share button to URL bar, always visible
- Fix transcript textarea not showing shared text on load
- Stream live mic transcript into textarea during recording
- Add live mic transcript visualizer (v6)
- Extract shared utilities to reduce duplication across sub-app views
- Restore duration from parsed transcript on share URL load
- Fix text selection when dragging transcript scrubber outside bounds
- Share raw transcript text (VTT/SRT) instead of processed plain text
- Add share button that encodes transcript + embedding coordinates in URL
