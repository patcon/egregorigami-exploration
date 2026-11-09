# Changelog

Entries are in chronological order (oldest first).

## Unreleased

- Add download button for 3D embedding points (v3 modal + v5 inline panel) — exports `embeddings-3d.json` once embeddings are complete
- Sync `?videoId=` querystring in real time as YouTube URL is typed into any view (v2, v3, v4, v5)
- Make v5 the default landing page; index nav moved to `#index` (also accessible via "Version Index" link on all pages)
- Fix white screen when invalid YouTube URL is entered (e.g. `?v=bad`) — `extractVideoId` now validates the 11-char video ID format for YouTube URL inputs, not just raw strings
- Migrate styling from hand-written CSS files to Tailwind CSS v4; all 8 component CSS files replaced with utility classes in JSX; animations, `color-mix()` rules, and pseudo-element styles retained in `index.css`
- Fix all ESLint warnings and errors: move ref writes out of render into effects, type `progress_callback` params, fix recursive rAF `tick` pattern in `SegmentProjectorModal`, and suppress intentional rule violations with targeted disable comments
- Warn in v7 (below video, above transcript) when transcript duration doesn't match the YouTube video duration (threshold: >10s or >5%). "Fetch Transcript" button moved into transcript section as "Load", alongside a "Transcript" section header.
- Add v7: mobile-optimized copy of v5, now the default landing page. Single-column layout on mobile (≤768px). Removes "allow faster" checkbox — video embed hides automatically when speed exceeds 2×. Removes "segments" window mode (words-only). Share URL updated to `#v7`.
- Add info button (ⓘ) to v7 URL bar that opens a modal; modal contains a "Version Index →" link, replacing the fixed bottom-left link on that view.
- Fix WebGL "zero size framebuffer" errors in ScatterPlot3D, ScatterPlot3DV5, and ScatterPlot3DV6 when component mounts inside a hidden tab — defer Three.js renderer init until container has non-zero dimensions, using a one-shot ResizeObserver
- Fix 3D scatter not rendering in v7 after deferred-init fix — `extraTabContent` wrapper in TranscriptViewer was missing `flex flex-col`, causing `h-full` on the mount div to resolve to zero
- Fix v7 mobile: prevent pull-to-refresh and iOS bounce — lock `html` overflow on mount, add `overscroll-y-contain` to inner scrollable areas (word display, segments list) so their overscroll doesn't propagate, use `100dvh` for dynamic viewport height, and add `flex-shrink-0` to YouTube player wrapper
- Cache 3D UMAP points in localStorage keyed by video ID (`yt-3d-points-<videoId>`) across all embedding views (v3–v7) — points are restored automatically on page reload, and overwritten when a new embedding is run for the same video
- Add URL history autocomplete dropdown to YouTube URL inputs across all embedding views (v3–v7) — shows video title (fetched async via YouTube oEmbed) and URL; title appears above URL in the list but selecting an entry sets only the URL value; history persists in localStorage (`yt-url-history`, max 15 entries)
- Keep prior scatter plot visible while a new embedding runs or is cancelled — cancelling mid-progress restores the previous visualization
- Rename "Reset Viz" to "Rerun Viz" in v7 — clicking it shows the model selector and Visualize button with an ✕ to return to the visualization without re-embedding; the prior scatter plot remains visible throughout
- Store embedding model ID and segment count alongside cached 3D points in localStorage — displayed as a small info overlay in the bottom-right corner of the scatter plot
- v7 desktop layout: at 1024px+ width, the layout splits into a top row (video | 3D plot) and a bottom panel (Raw/Windowed/Segments transcript tabs); landscape mobile (640px–1023px) keeps the existing two-column layout with all tabs on the right
- Add `#manual` view: type lines of text into a textarea — each line becomes one embedding node; prefix with `- ` to start a new branch, indent to continue it; branches appear as distinct colored paths in the 3D scatter plot, each visually continuing from the branching point; renderer toggle (Points / Tube / Glow) matches the styles available in other embedding views
- Make Glow renderer adaptive to canvas size and zoom: particle sizes scale with canvas height (`uScale` uniform), fill density increased (12→20 particles per segment), and bloom strength/radius update each frame based on camera distance so the glow stays visible when zoomed out or viewing full-screen
- Preserve camera position when switching renderers in `#manual` view — camera state is stored in a ref and passed as `initialCameraState` to each renderer on mount
- Add Share button to `#manual` view — compresses textarea text with pako into a `?share=` query param and copies the URL to clipboard; loading a share URL restores the text automatically
- Share button in `#manual` gains an "auto-embed" checkbox — when checked, the shared URL triggers embedding automatically on load
- Default renderer in `#manual` changed to Glow; default embedding model changed to MiniLM-L12 (balanced)
- Add "Config" tab with a Glow Strength slider (range 0–2, default 1.0) that adjusts bloom intensity live without re-embedding; persisted to localStorage; available in both desktop and mobile layouts; only affects the Glow (Shader) renderer
- Smooth branch divergence in Tube renderer: branch tubes now prepend several root nodes so both curves share the same CatmullRom tangent at the junction; colors blend from root to branch over the overlap region so branches appear to peel off naturally rather than snap into view
- Add branching playhead to `#manual` view: ▶/⏸ button and scrubber animate a red sphere through all segments; at the branch point the root sphere disappears and one sphere per branch continues in sync; works in all three renderers (Tube, Glow, Points)
- Unify main-path playhead: the first `- ` arm (bid=1) is treated as a continuation of the trunk, so the main sphere travels root→arm1 without interruption; actual branch spheres (bid≥2) peel off from the trunk-end fork point as before
- Add alternative Cloudflare Workers deploy (`pnpm cf:deploy`, `.github/workflows/deploy-cloudflare.yml`) — the Worker serves the built app and `/api/transcript`, so "Fetch Transcript" works in-app instead of linking out to youtube-transcript.io; the GitHub Pages deploy is unchanged
- Fall back to the manual transcript flow (youtube-transcript.io link + VTT upload) when the server-side `/api/transcript` fetch fails for a video — YouTube often bot-blocks Cloudflare's datacenter IPs
- Cloudflare Worker fetches transcripts via [Supadata](https://supadata.ai) (`mode=native`, existing captions only) when the `SUPADATA_API_KEY` secret is set, since YouTube bot-blocks direct requests from Cloudflare; local `pnpm dev` still fetches from YouTube directly
- Cache transcripts in Workers KV (`TRANSCRIPTS` binding, keyed by video ID, no expiry) so each video is fetched from Supadata at most once; responses carry an `X-Transcript-Cache: HIT|MISS` header
- Also cache "no transcript" answers from Supadata (video has no captions or doesn't exist) for 24h under `unavailable:v1:<videoId>`, returned as 404 so the frontend falls back to the manual flow; transient failures (rate limits, auth, outages) are never cached. Existing cached transcripts are untouched
- Stop bundling ONNX Runtime's ~22 MB `.wasm` into `dist/` — it was already loaded from jsDelivr at runtime; the CDN path is now set explicitly (`src/loadTransformers.ts`) and a Vite plugin drops the unused copy. Build output shrinks from ~24 MB to ~2 MB, well under Cloudflare's 25 MiB per-asset limit

- Fix VTT subtitle parsing when the last cue has a malformed end timestamp (e.g. `NaN:NaN:NaN.NaN`) — duration no longer displays as NaN and cursor sync works correctly
- Fix embedding model failing to load on the Cloudflare deploy with a CORS error — Hugging Face 404s requests with a `*.workers.dev` Referer, so the site now sends `Referrer-Policy: no-referrer` (via `public/_headers`)
- Normalize Glow renderer bloom by point count — long transcripts no longer blow out into a white haze (bloom scales by `sqrt(150 / segments)`, floored at 0.25)
- Default to the Glow renderer in v5 and v7 (a previously saved renderer choice still wins)
- With auto-scroll on, clicking a point in the 3D embedding (v5, v7) now scrolls the transcript to that spot, even while paused
- "Points + Line" renderer now uses the same blue → cyan → yellow gradient as Glow (was a blue → red HSL sweep); palette shared via `src/palettes.ts`
- Fix playhead scrub-bar thumb jumping up and left on hover — the hover `transform` stacked a second offset on Tailwind v4's `translate` property, and a stray `margin-top` shifted the bar; now uses `group-hover:scale-130` / `hover:h-[6px]`
- Transcript auto-scroll now follows the cursor while scrubbing the timeline (previously only during playback)
- "Following" camera mode now swings smoothly around the cursor when the path changes direction, instead of snapping behind it at every bend (shared `src/followCamera.ts`, used by the tube and glow renderers)
- Add v8, now the default landing page: v7 plus a live mode ("Embed as transcript plays", on by default in Config) that simulates live-event transcription. Segments are embedded once the playhead passes them, and the 3D layout is recomputed every N segments ("Re-layout every N segments", default 3) and animates to its new positions. Each layout warm-starts UMAP from the previous one and is Procrustes-aligned onto the previous frame, so the view doesn't flip or spin. New `ScatterPlot3DLive` Points + Line renderer tweens positions in place. Re-layout default is every 1 segment.
- All 3D renderers (Points + Line, Cividis Tube, Glow, Live) now use a black background so the colour gradients read well in light mode too (shared `SCENE_BG` in `src/palettes.ts`)
- v8 live renderer: path lines are now real thick lines (default 3px, via three.js `Line2`; plain WebGL lines are always 1px), and Config has "Line width" and "Node size" sliders (saved in localStorage; the playhead sphere grows with node size)
- v8 Config: "Auto-rotate" toggle and "Rotation speed" slider (default ~60s per turn) that slowly orbits the live 3D view around its centre; dragging still works, and it combines with the tracking/following camera modes
- v8 Config: "Ground grid" toggle (on by default) that shows a fixed floor grid beneath the live 3D view, so you keep your bearings while points move and re-layout
- v8 live mode never starts a layout while the worker is still busy, including right after "Reset live" or a model/video change (previously the next request was sent immediately and queued behind the stale job). The 3D badge now shows how many passed segments are waiting for the next layout.
- Fix the page stalling (~0.4–0.8s per cursor move) on long transcripts, which was most noticeable when jumping ahead on the timeline and then playing. `TranscriptViewer` now renders words in memoised chunks so only the chunk(s) around the highlight re-render (all views), and v8 memoises its Segments list instead of rebuilding every row on each cursor move.
- v8 live mode: after a big jump ahead, the backlog is embedded in batches of 20 segments, so points appear within a few seconds and visibly catch up, instead of the 3D view staying blank until the whole backlog is embedded
- v8 Config: "UMAP distance" setting (Euclidean, the default, or Cosine) for the 3D projection. Changing it restarts the live layout and also applies to a full "Run embedding"; saved in localStorage (`umap-metric`)
- Tube and Glow renderers now work in the live views (v8, v9), not just after a full Visualize run: a Renderer selector in the live settings switches between Points + Line, Tube and Glow, and the path rebuilds as the layout tweens. Line width sets the tube's thickness and the glow's trail; v9 dims the inactive session's tube/glow and gains a Glow strength slider. Shared code is in `src/livePathVisuals.ts`.
- Tube renderer uses the shared blue → cyan → yellow gradient instead of cividis, whose dull grey-olive middle was a leftover from the old white background; renamed "Cividis Tube" to "Tube" in the selectors

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
- Add "forked" playback mode to #manual view — playhead travels the main canonical branch, rapidly zips back to the branch point, then traverses the fork; toggle between "parallel" and "forked" modes via buttons in the playhead controls (only shown when a fork branch exists)
- Add v9 (`#v9`), "Parallel Live Sessions": simulates two conference sessions running at the same time. Load a video into session A and session B. Both play together (the hidden one muted), and their segments are embedded live into one shared 3D space, drawn as two coloured paths, each with its own playhead. An A/B toggle in the URL bar switches the video, Raw/Windowed/Segments tabs and scrub bar to that session. Both sessions share one event clock: scrubbing, arrow keys and point clicks move both, the visible video drives the clock (the other takes over once it ends), and a background video that drifts more than 1.5s is re-seeked. Config (window, overlap, speed, model, UMAP, styling) is shared. Clicking a point jumps to that moment, switching sessions if needed. `?a=<videoId>&b=<videoId>` sets both videos. Above 2× both sessions run on a simulated clock.
- v9: after jumping ahead, the backlog from both sessions is embedded in the order it was spoken, so both paths grow together instead of one session filling in before the other starts
- v9 info modal: link to the Living Room Conversations YouTube playlist as a source of example videos
- Centre the info modals in v7, v8 and v9 again (Tailwind's base styles had reset the dialog's auto margin, pinning it top-left)
