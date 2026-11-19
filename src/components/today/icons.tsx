const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export function ChevronLeft() {
  return (
    <svg {...base}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function ChevronRight() {
  return (
    <svg {...base}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...base}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}
