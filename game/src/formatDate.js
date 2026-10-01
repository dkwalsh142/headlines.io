// Display formatting for issue dates. Kept out of dateUtils.js, which
// mirrors pipeline/src/dateUtils.js and should stay in sync with it.

const MONTH_ABBREV = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

// `date` is the issue's YYYY-MM-DD play/schedule string (see dateUtils.js —
// day boundary is fixed UTC). Parsed manually rather than via `new
// Date(dateString)` + local-time formatting, which can display the wrong
// calendar day in a negative-UTC-offset timezone.
// { showYear: false } gives just "Oct. 1".
export function formatPlayDate(date, { showYear = true } = {}) {
  if (!date) return '';
  const [year, month, day] = date.split('-').map(Number);
  const monthName = MONTH_ABBREV[month - 1] ?? '';
  return showYear ? `${monthName} ${day}, ${year}` : `${monthName} ${day}`;
}
