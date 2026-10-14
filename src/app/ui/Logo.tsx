/**
 * The DhakaDrive-VQA logo, drawn inline in the current text colour so it
 * follows the light and dark themes. The originals (with a white background)
 * are in public/brand/.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={className}>
      <g transform="translate(20, 20)" stroke="currentColor" fill="none">
        <path d="M 52,0 H 0 V 80 H 80 V 28" strokeWidth="8.5" strokeLinecap="square" />
        <line x1="0" y1="80" x2="70" y2="10" strokeWidth="8.5" strokeLinecap="round" />
        <circle cx="70" cy="10" r="12.5" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const lg = size === "lg";
  return (
    <span role="img" aria-label="DhakaDrive-VQA" className={`inline-flex items-center ${lg ? "gap-2.5" : "gap-1.5"}`}>
      <LogoMark className={lg ? "h-12 w-12" : "h-7 w-7"} />
      <span
        className={lg ? "text-3xl" : "text-lg leading-none"}
        style={{ fontFamily: "'Times New Roman', Times, Georgia, serif" }}
      >
        <span className="font-bold">DhakaDrive</span>VQA
      </span>
    </span>
  );
}
