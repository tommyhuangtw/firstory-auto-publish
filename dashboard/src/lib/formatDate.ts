/**
 * Parse a SQLite datetime string (UTC) and format as local time.
 *
 * SQLite `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" without timezone info.
 * These are UTC — we append 'Z' to ensure correct parsing, then format to local time.
 */
export function formatLocalDateTime(utcStr: string | null): string {
  if (!utcStr) return '';
  // SQLite: "2026-04-27 10:00:05" — append Z for UTC
  // ISO: "2026-04-27T10:00:05Z" or "2026-04-27T10:00:05.000Z" — already has T
  const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Format a UTC date string to local date only (YYYY/MM/DD) */
export function formatLocalDate(utcStr: string | null): string {
  if (!utcStr) return '';
  const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Get the local day-of-week index (0=Sun) from a UTC datetime string */
export function getLocalDayOfWeek(utcStr: string): number {
  const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z';
  return new Date(iso).getDay();
}
