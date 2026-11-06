// TEMPORARY: diagnose why YouTube rejects transcript requests from Cloudflare.
// Mirrors the steps youtube-transcript-plus takes, but reports raw status codes
// and body snippets instead of collapsing them into a single error.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const CLIENTS: Record<string, Record<string, string>> = {
  ANDROID: { clientName: 'ANDROID', clientVersion: '20.10.38' }, // what the library uses
  WEB: { clientName: 'WEB', clientVersion: '2.20250101.00.00' },
  MWEB: { clientName: 'MWEB', clientVersion: '2.20250101.01.00' },
  IOS: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2' },
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' },
}

const snippet = (s: string, n = 400) => s.slice(0, n)

type CaptionTrack = { baseUrl?: string; languageCode?: string }

export async function debugTranscript(videoId: string, colo: unknown): Promise<object> {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'en' }
  const report: Record<string, unknown> = { videoId, colo }

  // 1) Watch page
  let apiKey: string | undefined
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers, redirect: 'manual' })
    const body = await res.text()
    apiKey = (body.match(/"INNERTUBE_API_KEY":"([^"]+)"/) ?? body.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/))?.[1]
    report.watchPage = {
      status: res.status,
      location: res.headers.get('location'),
      contentType: res.headers.get('content-type'),
      bodyLength: body.length,
      hasRecaptcha: body.includes('g-recaptcha'),
      hasSignInToConfirm: body.includes('Sign in to confirm'),
      apiKeyFound: !!apiKey,
      snippet: res.ok ? undefined : snippet(body),
    }
  } catch (e) {
    report.watchPage = { error: String(e) }
  }

  // 2) Innertube player, per client
  const players: Record<string, unknown> = {}
  let firstTrack: { client: string; track: CaptionTrack } | undefined
  for (const [name, client] of Object.entries(CLIENTS)) {
    try {
      const url = `https://www.youtube.com/youtubei/v1/player${apiKey ? `?key=${apiKey}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client }, videoId }),
      })
      const text = await res.text()
      let json: { playabilityStatus?: { status?: string; reason?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } } | undefined
      try { json = JSON.parse(text) } catch { /* not JSON */ }
      const tracks = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
      if (!firstTrack && tracks[0]?.baseUrl) firstTrack = { client: name, track: tracks[0] }
      players[name] = {
        status: res.status,
        playability: json?.playabilityStatus?.status,
        reason: json?.playabilityStatus?.reason,
        captionTracks: tracks.map(t => t.languageCode),
        snippet: json ? undefined : snippet(text),
      }
    } catch (e) {
      players[name] = { error: String(e) }
    }
  }
  report.player = players

  // 3) Caption track fetch, from the first client that returned one
  if (firstTrack) {
    try {
      const url = firstTrack.track.baseUrl!.replace(/&fmt=[^&]+/, '')
      const res = await fetch(url, { headers })
      const body = await res.text()
      report.timedtext = { fromClient: firstTrack.client, status: res.status, bodyLength: body.length, snippet: snippet(body, 200) }
    } catch (e) {
      report.timedtext = { error: String(e) }
    }
  }

  return report
}
