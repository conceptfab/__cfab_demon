// Jedno źródło prawdy dla kolorów statusu projektu w całej aplikacji.
// Wcześniej `statusColor()` był skopiowany w PmProjectsList, Clients i ClientPage
// (z komentarzami "Mirrors the PM module") — każda kopia mogła się rozjechać.
// Tu definiujemy semantykę raz, w dwóch trybach: pełny chip (badge) i sam kolor tekstu.

interface StatusTone {
  /** Pełny chip: tło + tekst + obramowanie — dla badge'y read-only (np. lista PM). */
  badge: string;
  /** Sam kolor tekstu — dla kontrolek (np. <select> statusu w panelu Clients). */
  text: string;
}

const STATUS_TONE: Record<string, StatusTone> = {
  active: {
    badge: 'bg-green-500/15 text-green-400 border-green-500/30',
    text: 'text-green-400',
  },
  frozen: {
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    text: 'text-blue-400',
  },
  excluded: {
    badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    text: 'text-yellow-400',
  },
  archived: {
    badge: 'bg-muted text-muted-foreground border-border',
    text: 'text-muted-foreground',
  },
};

/** Klasy pełnego chipa statusu (tło/tekst/border). Nieznany status → brak koloru. */
export function statusBadgeClass(status: string): string {
  return STATUS_TONE[status]?.badge ?? '';
}

/** Klasa koloru tekstu statusu. Nieznany status traktujemy jak „active". */
export function statusTextClass(status: string): string {
  // safe: STATUS_TONE.active is defined as a literal key in the object above
  return STATUS_TONE[status]?.text ?? STATUS_TONE['active']!.text;
}
