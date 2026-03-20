import { useState, useEffect } from 'react'
import TranscriptViewer from './TranscriptViewer'
import YoutubeTranscriptViewer from './YoutubeTranscriptViewer'
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
  return <IndexPage />
}

export default App
