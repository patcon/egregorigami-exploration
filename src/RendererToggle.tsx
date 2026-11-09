import type { LiveRenderer } from './livePathVisuals'

const OPTIONS: { value: LiveRenderer; label: string }[] = [
  { value: 'original', label: 'Lines' },
  { value: 'cividis-tube', label: 'Tubes' },
  { value: 'glow', label: 'Glow' },
]

const GROUP = 'flex rounded border border-white/[0.18] bg-black/55 overflow-hidden'
const BTN = 'py-[3px] px-2 cursor-pointer transition-[background,color] duration-150'
const ON = 'bg-white/20 text-white'
const OFF = 'text-white/65 hover:bg-black/75 hover:text-white'

interface Props {
  value: LiveRenderer
  onChange: (v: LiveRenderer) => void
  /** Omit `onAutoRotateChange` to hide the rotate button (renderers that can't auto-rotate). */
  autoRotate?: boolean
  onAutoRotateChange?: (on: boolean) => void
}

/** Renderer switch (and optional auto-rotate toggle), overlaid on the top-right of a 3D view. */
export default function RendererToggle({ value, onChange, autoRotate = false, onAutoRotateChange }: Props) {
  return (
    <div className="absolute top-2 right-2 z-10 flex gap-1.5 text-[11px] select-none">
      {onAutoRotateChange && (
        <button
          aria-pressed={autoRotate}
          title="Auto-rotate"
          onClick={() => onAutoRotateChange(!autoRotate)}
          className={`${GROUP} ${BTN} ${autoRotate ? ON : OFF}`}
        >
          ⟳ Rotate
        </button>
      )}
      <div role="radiogroup" aria-label="Renderer" className={GROUP}>
        {OPTIONS.map(o => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`${BTN} ${value === o.value ? ON : OFF}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
