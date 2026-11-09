/** House icon linking back to the version index; sits beside the ⓘ button in the URL bar. */
export default function HomeLink() {
  return (
    <a
      href="#index"
      title="Version index"
      aria-label="Version index"
      className="flex-shrink-0 w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-80 text-inherit"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
      </svg>
    </a>
  )
}
