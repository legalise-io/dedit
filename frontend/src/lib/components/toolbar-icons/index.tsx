const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function UndoIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

export function RedoIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  );
}

export function BoldIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.5}>
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  );
}

export function ItalicIcon() {
  return (
    <svg {...iconProps}>
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  );
}

export function TrackChangesIcon() {
  return (
    <svg {...iconProps}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function PrevChangeIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function NextChangeIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function AcceptIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function RejectIcon() {
  return (
    <svg {...iconProps}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function AcceptAllIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="18 6 9 17 4 12" />
      <polyline points="22 10 13 21 8 16" />
    </svg>
  );
}

export function RejectAllIcon() {
  return (
    <svg {...iconProps}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

export function AddRowBeforeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
      <path d="M12 3v6" />
      <path d="M9 6l3-3 3 3" />
    </svg>
  );
}

export function AddRowAfterIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
      <path d="M12 15v6" />
      <path d="M9 18l3 3 3-3" />
    </svg>
  );
}

export function DeleteRowIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
