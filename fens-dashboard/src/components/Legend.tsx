export function Legend() {
  return (
    <details className="legend-box">
      <summary>Legend</summary>
      <LegendList />
    </details>
  );
}
function LegendList() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <svg width="22" height="16" aria-hidden="true">
          <rect
            x="2"
            y="2"
            width="18"
            height="12"
            rx="3"
            fill="#dbe4ff"
            stroke="#1e3a8a"
            strokeWidth="2"
          />
        </svg>
        Screen
      </li>
      <li>
        <svg width="22" height="18" aria-hidden="true">
          <polygon points="11,1 21,9 11,17 1,9" fill="#fee2e2" stroke="#b91c1c" strokeWidth="2" />
        </svg>
        Orphan (no inbound link)
      </li>
      <li>
        <svg width="20" height="20" aria-hidden="true">
          <polygon
            points="6,1 14,1 19,6 19,14 14,19 6,19 1,14 1,6"
            fill="#ffedd5"
            stroke="#9a3412"
            strokeWidth="2"
          />
        </svg>
        Dead end (no outbound link)
      </li>
      <li>
        <svg width="22" height="16" aria-hidden="true">
          <rect
            x="2"
            y="2"
            width="18"
            height="12"
            rx="3"
            fill="#dbe4ff"
            stroke="#1e3a8a"
            strokeWidth="2"
            strokeDasharray="4 2"
          />
        </svg>
        State-required (dashed border)
      </li>
      <li>
        <svg width="34" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="26" y2="5" stroke="#6b7280" strokeWidth="2" />
          <polygon points="26,1 33,5 26,9" fill="#6b7280" />
        </svg>
        Link
      </li>
      <li>
        <svg width="34" height="10" aria-hidden="true">
          <line
            x1="1"
            y1="5"
            x2="26"
            y2="5"
            stroke="#6b7280"
            strokeWidth="2"
            strokeDasharray="5 3"
          />
          <polygon points="26,1 33,5 26,9" fill="#6b7280" />
        </svg>
        Click (JavaScript)
      </li>
      <li>⚠ N = screen-specific issues</li>
      <li>⊘ no link path = no plain link reaches it (crawlers miss it)</li>
      <li>Group A, B… = community (Tools tab, Communities)</li>
    </ul>
  );
}
