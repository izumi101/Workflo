/**
 * Minimal relative-time formatter (no date library in the workspace — see
 * apps/web/package.json). Good enough for comment timestamps; not intended
 * as a general i18n solution.
 */
export function formatRelativeTime(date: Date | string): string {
  const target = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.round((target.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);

  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  let value = seconds;
  let divisor = 1;
  for (const [amount, unit] of units) {
    if (abs < divisor * amount) {
      const rounded = Math.round(value);
      const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
      return rtf.format(rounded, unit as Intl.RelativeTimeFormatUnit);
    }
    divisor *= amount;
    value = seconds / divisor;
  }
  return target.toLocaleDateString();
}
