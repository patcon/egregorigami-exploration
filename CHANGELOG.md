# Changelog

## Unreleased

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
