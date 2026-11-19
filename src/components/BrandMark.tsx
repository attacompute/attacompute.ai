export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--bg-surface-2)" stroke="var(--border-strong)" />
      <path
        d="M16 5.5L25.2 10.8V21.2L16 26.5L6.8 21.2V10.8L16 5.5Z"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M16 10.2L21.1 13.1V18.9L16 21.8L10.9 18.9V13.1L16 10.2Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.2" fill="var(--accent)" />
    </svg>
  );
}
