import { useEffect } from 'react'

interface Props {
  segments: string[]
  onClose: () => void
}

export default function SegmentsListModal({ segments, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg border border-border rounded-[10px] w-full max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between py-3.5 px-5 border-b border-border flex-shrink-0">
          <h2 className="m-0 text-[17px] text-text-h">Segments</h2>
          <button className="bg-transparent border-0 text-text text-lg cursor-pointer py-1 px-2 rounded leading-none hover:bg-code-bg" onClick={onClose}>✕</button>
        </div>
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="w-full flex flex-col min-h-0 overflow-hidden">
            <ul className="list-none p-0 m-0 overflow-y-auto flex-1 min-h-0">
              {segments.map((seg, i) => (
                <li key={i} className="flex gap-2 py-2 px-3.5 border-b border-border text-[13px] items-start">
                  <span className="text-text opacity-50 min-w-[28px] flex-shrink-0 text-right tabular-nums pt-[1px]">{i + 1}</span>
                  <span className="text-text-h leading-[1.45]">{seg}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
