import { useRef, useState } from 'react'
import type { UrlHistoryEntry } from './useUrlHistory'

interface Props {
  value: string
  onChange: (url: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  disabled?: boolean
  placeholder?: string
  history: UrlHistoryEntry[]
}

export default function UrlHistoryInput({ value, onChange, onKeyDown, disabled, placeholder, history }: Props) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = history.filter(e =>
    !value || e.url.toLowerCase().includes(value.toLowerCase()) || e.title?.toLowerCase().includes(value.toLowerCase())
  )
  const showDropdown = open && filtered.length > 0

  function select(url: string) {
    onChange(url)
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="relative flex-1 min-w-0">
      <input
        ref={inputRef}
        type="url"
        className="w-full py-1.5 px-2.5 border border-border rounded-md bg-code-bg text-text-h text-sm focus:outline-2 focus:outline-accent focus:outline-offset-[1px] disabled:opacity-50 disabled:cursor-not-allowed"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false)
          onKeyDown?.(e)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        placeholder={placeholder}
      />
      {showDropdown && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-bg border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {filtered.map(entry => (
            <button
              key={entry.url}
              type="button"
              className="w-full text-left px-3 py-2 flex flex-col gap-0.5 hover:bg-code-bg cursor-pointer border-0 bg-transparent"
              onMouseDown={e => { e.preventDefault(); select(entry.url) }}
            >
              {entry.title && (
                <span className="text-xs text-text-h font-medium truncate">{entry.title}</span>
              )}
              <span className={`text-xs truncate ${entry.title ? 'opacity-40' : 'text-text-h'}`}>{entry.url}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
