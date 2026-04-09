import { useState, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubeTranscriptViewer from './YoutubeTranscriptViewer'
import YoutubeEmbeddingProjector from './YoutubeEmbeddingProjector'
import EmbeddingLayoutView from './EmbeddingLayoutView'
import EmbeddingLayoutViewV5 from './EmbeddingLayoutViewV5'
import EmbeddingLayoutViewV7 from './EmbeddingLayoutViewV7'
import MicTranscriptViewer from './MicTranscriptViewer'
import ManualEmbeddingProjector from './ManualEmbeddingProjector'

function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return hash
}

function IndexPage() {
  return (
    <>
      <section id="center" className="flex flex-col gap-[25px] content-center items-center flex-1 max-[1024px]:px-5 max-[1024px]:pt-8 max-[1024px]:pb-6 max-[1024px]:gap-[18px]">
        <div>
          <h1>egregorigami</h1>
          <p>Explorations of collective intelligence, narrative space, and protein folding.</p>
        </div>
        <ul className="list-none p-0 m-0 flex flex-col gap-2 text-left">
          <li>
            <a href="#v1" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Transcript Window Visualizer</strong>
              <span className="text-sm text-text">Watch an embedding context window slide through a transcript in real time.</span>
            </a>
          </li>
          <li>
            <a href="#v2" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">YouTube Transcript Visualizer</strong>
              <span className="text-sm text-text">Paste a YouTube URL and watch the embedding window slide through the transcript.</span>
            </a>
          </li>
          <li>
            <a href="#v3" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Embedding Projector</strong>
              <span className="text-sm text-text">Generate sentence embeddings in-browser and explore the 3D semantic space with an interactive scatter plot.</span>
            </a>
          </li>
          <li>
            <a href="#v4" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Embedding Layout</strong>
              <span className="text-sm text-text">Side-by-side view: YouTube player and transcript with an inline 3D embedding panel.</span>
            </a>
          </li>
          <li>
            <a href="#v5" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Embedding Layout (New Renderers)</strong>
              <span className="text-sm text-text">Same as v4, with switchable renderers: original points, Cividis tube, and glow shader.</span>
            </a>
          </li>
          <li>
            <a href="#v6" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Live Mic Transcript Visualizer</strong>
              <span className="text-sm text-text">Record speech via your microphone and watch the embedding window slide through the live transcript.</span>
            </a>
          </li>
          <li>
            <a href="#v7" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Embedding Layout (Mobile)</strong>
              <span className="text-sm text-text">Mobile-optimized version of v5. (default)</span>
            </a>
          </li>
          <li>
            <a href="#manual" className="flex flex-col gap-1 py-4 px-5 border border-border rounded-lg no-underline text-text-h bg-social-bg transition-[box-shadow,border-color] duration-200 hover:shadow-[var(--shadow)] hover:border-accent-border">
              <strong className="text-base">Manual Branching Projector</strong>
              <span className="text-sm text-text">Type or paste lines of text — each line becomes an embedding node; use bullet syntax to create branches visualized in 3D.</span>
            </a>
          </li>
        </ul>
      </section>
      <div className="ticks"></div>
      <section id="spacer" className="h-[88px] border-t border-border max-[1024px]:h-12"></section>
    </>
  )
}

function IndexLink() {
  return (
    <a
      href="#index"
      className="fixed bottom-4 left-4 z-[9999] text-xs opacity-50 no-underline text-inherit"
    >
      Version Index
    </a>
  )
}

function GitHubCorner() {
  return (
    <a
      href="https://github.com/patcon/egregorigami-exploration"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Fork me on GitHub"
      className="fixed top-0 right-0 z-[9999]"
    >
      <svg
        width="80"
        height="80"
        viewBox="0 0 250 250"
        className="fill-[#151513] text-white absolute top-0 right-0"
        aria-hidden="true"
      >
        <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
        <path
          d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
          fill="currentColor"
          style={{ transformOrigin: '130px 106px' }}
        />
        <path
          d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.8 141.5,141.9 141.8,141.8 Z"
          fill="currentColor"
        />
      </svg>
    </a>
  )
}

function App() {
  const hash = useHash()
  if (hash === '#v1') return <><GitHubCorner /><IndexLink /><TranscriptViewer /></>
  if (hash === '#v2') return <><GitHubCorner /><IndexLink /><YoutubeTranscriptViewer /></>
  if (hash === '#v3') return <><GitHubCorner /><IndexLink /><YoutubeEmbeddingProjector /></>
  if (hash === '#v4') return <><GitHubCorner /><IndexLink /><EmbeddingLayoutView /></>
  if (hash === '#v5') return <><GitHubCorner /><IndexLink /><EmbeddingLayoutViewV5 /></>
  if (hash === '#v6') return <><GitHubCorner /><IndexLink /><MicTranscriptViewer /></>
  if (hash === '#v7') return <><GitHubCorner /><EmbeddingLayoutViewV7 /></>
  if (hash === '#manual') return <><GitHubCorner /><IndexLink /><ManualEmbeddingProjector /></>
  if (hash === '#index') return <><GitHubCorner /><IndexPage /></>
  return <><GitHubCorner /><EmbeddingLayoutViewV7 /></>
}

export default App
