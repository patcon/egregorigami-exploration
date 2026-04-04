# Changelog

## Unreleased

- Make v5 the default landing page; index nav moved to `#index` (also accessible via "Version Index" link on all pages)
- Sync `?videoId=` querystring in real time as YouTube URL is typed into any view (v2, v3, v4, v5)
- Add download button for 3D embedding points (v3 modal + v5 inline panel) — exports `embeddings-3d.json` once embeddings are complete

## Prior work (selected)

- Stream live mic transcript into textarea during recording
- Add live mic transcript visualizer (v6)
- Extract shared utilities to reduce duplication across sub-app views
- Restore duration from parsed transcript on share URL load
- Fix text selection when dragging transcript scrubber outside bounds
- Share raw transcript text (VTT/SRT) instead of processed plain text
- Add share button that encodes transcript + embedding coordinates in URL
