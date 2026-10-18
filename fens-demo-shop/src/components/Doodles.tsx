interface DoodleProps {
  className?: string;
}
export function StarDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M24 4 L29.5 19 L45 19.5 L32.5 29 L37 44 L24 35 L11 44.5 L15.5 29 L3 19.5 L18.5 19 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function SmileDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M24 43 C7 31 2 19 10 11 C16 5 22 8 24 14 C26 8 32 5 38 11 C46 19 41 31 24 43 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M17 22 Q24 30 31 22 M19 16 v3 M29 16 v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function RedLine({ className }: DoodleProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 600"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M40 0 C30 160 20 380 70 600"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
