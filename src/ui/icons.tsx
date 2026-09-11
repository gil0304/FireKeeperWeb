// Inline SVG icons (kept distinct from wood emoji).

export function LighterIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2.6c1.9 2.2 3.3 3.7 3.3 5.7a3.3 3.3 0 0 1-6.6 0c0-2 1.4-3.5 3.3-5.7z"
        fill="#ffb84d"
      />
      <path
        d="M12 5.4c.95 1.15 1.65 2 1.65 3a1.65 1.65 0 0 1-3.3 0c0-1 .7-1.85 1.65-3z"
        fill="#ff6a2a"
      />
      <rect x="8.8" y="12.2" width="6.4" height="9.2" rx="1.7" fill="#c2513a" />
      <rect x="8.8" y="12.2" width="6.4" height="2.6" rx="1.2" fill="#9aa0a8" />
      <rect x="10" y="16" width="1.4" height="4" rx="0.7" fill="#00000033" />
    </svg>
  );
}
