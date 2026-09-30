// Display formatting for issue dates. Kept out of dateUtils.js, which
// mirrors pipeline/src/dateUtils.js and should stay in sync with it.

const MONTH_ABBREV = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

// `date` is the issue's YYYY-MM-DD play/schedule string (see dateUtils.js —
// day boundary is fixed UTC). Parsed manually rather than via `new
// Date(dateString)` + local-time formatting, which can display the wrong
// calendar day in a negative-UTC-offset timezone.
export function formatPlayDate(date) {
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  const monthName = MONTH_ABBREV[month - 1] ?? '';
  return `${monthName} ${day}, ${year}`;
}
