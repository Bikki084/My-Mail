/** Local calendar day → ISO bounds for `sent_at` filters (inclusive). */
export function startOfLocalDayIso(dateYmd: string): string {
  const [y, m, d] = dateYmd.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function endOfLocalDayIso(dateYmd: string): string {
  const [y, m, d] = dateYmd.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
