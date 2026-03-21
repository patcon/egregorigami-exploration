import { useState, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubeTranscriptViewer from './YoutubeTranscriptViewer'
import YoutubeEmbeddingProjector from './YoutubeEmbeddingProjector'
import EmbeddingLayoutView from './EmbeddingLayoutView'
import './App.css'

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
      <section id="center">
        <div>
          <h1>egregorigami</h1>
          <p>Explorations in collective intelligence and machine perception.</p>
        </div>
        <ul className="app-list">
          <li>
            <a href="#v1">
              <strong>Transcript Window Visualizer</strong>
              <span>Watch an embedding context window slide through a transcript in real time.</span>
            </a>
          </li>
          <li>
            <a href="#v2">
              <strong>YouTube Transcript Visualizer</strong>
              <span>Paste a YouTube URL and watch the embedding window slide through the transcript.</span>
            </a>
          </li>
          <li>
            <a href="#v3">
              <strong>Embedding Projector</strong>
              <span>Generate sentence embeddings in-browser and explore the 3D semantic space with an interactive scatter plot.</span>
            </a>
          </li>
          <li>
            <a href="#v4">
              <strong>Embedding Layout</strong>
              <span>Side-by-side view: YouTube player and transcript with an inline 3D embedding panel.</span>
            </a>
          </li>
        </ul>
      </section>
      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

function App() {
  const hash = useHash()
  if (hash === '#v1') return <TranscriptViewer />
  if (hash === '#v2') return <YoutubeTranscriptViewer />
  if (hash === '#v3') return <YoutubeEmbeddingProjector />
  if (hash === '#v4') return <EmbeddingLayoutView />
  return <IndexPage />
}

export default App
