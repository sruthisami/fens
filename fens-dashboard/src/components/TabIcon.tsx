const PATHS: Record<string, string> = {
  issues: 'M12 3 2 20h20L12 3z M12 10v4 M12 17h.01',
  tools: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4',
  investigate: 'M11 5a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M15.5 15.5 20 20',
  arbitration: 'M12 4v16 M7 20h10 M5 7h14 M5 7l-3 6h6z M19 7l-3 6h6z',
  compare: 'M7 4v16 M17 4v16 M7 9h10 M14 6l3 3-3 3',
  tracking: 'M4 6h.01 M4 12h.01 M4 18h.01 M8 6h12 M8 12h12 M8 18h12',
  handoffs:
    'M6 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4z M18 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4z M8 6h6a4 4 0 0 1 4 4v6',
  memory: 'M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2z M5 20a2 2 0 0 0 2 1h12v-3',
  ask: 'M4 5h16v11H10l-6 4z',
};

export function TabIcon({ name }: { name: string }) {
  return (
    <svg
      className="tab-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
