// SPDX-License-Identifier: GPL-3.0-or-later
// Number, size, time and date formats used on every screen.

const nf = new Intl.NumberFormat("en-US");

/** Milliseconds from an engine time: ISO 8601 (jobs, UTC) or "yyyy-mm-dd hh:mm:ss" (repairs: the
 *  worker's local time, which is this computer's). Safari can't parse the second form as written. */
export function toMillis(t: string | null | undefined): number {
  if (!t) return NaN;
  return Date.parse(/^\d{4}-\d\d-\d\d \d/.test(t) ? t.replace(" ", "T") : t);
}

export function formatInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "–" : nf.format(Math.round(n));
}

const nfAll = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

/** A measured value: 4 significant digits (0.00312, 71.34), whole numbers in full (1,234,567), and an
 *  exponent when very small or big (2.150e-7). The same rules as the engine's own pages. */
export function formatNumber(x: number | null | undefined, digits = 4): string {
  if (x == null || !Number.isFinite(x)) return "–";
  if (Number.isInteger(x)) return nf.format(x);
  const a = Math.abs(x);
  if (a < 1e-3 || a >= 1e6) return x.toExponential(digits - 1);
  const r = Number(x.toPrecision(digits));
  return a >= 1000 ? nfAll.format(r) : String(r);
}

/** A count with its noun, which is singular for one: "1 job", "3 jobs", "1 job kind". The plural is the noun with an
 *  s unless given. */
export function formatCount(n: number, one: string, many = `${one}s`): string {
  return `${nf.format(n)} ${n === 1 ? one : many}`;
}

/** 1 234 567 cells → "1.23 M"; small counts stay whole. */
export function formatCells(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)} M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(0)} k`;
  return nf.format(n);
}

export function formatPercent(fraction: number | null | undefined, digits = 0): string {
  if (fraction == null || !Number.isFinite(fraction)) return "–";
  return `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(digits)} %`;
}

/** Seconds → "2 h 05 min", "4 min 12 s", "12 s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(r).padStart(2, "0")} s`;
  return `${r} s`;
}

/** Time between two ISO times (or from one until now). */
export function elapsed(fromIso: string | null | undefined, toIso?: string | null, now = Date.now()): number | null {
  if (!fromIso) return null;
  const a = toMillis(fromIso);
  const b = toIso ? toMillis(toIso) : now;
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 1000) : null;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** ISO time → "3 min ago", "yesterday", or a date for anything older than a week. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  const t = toMillis(iso);
  if (!Number.isFinite(t)) return "–";
  const d = (t - now) / 1000;
  const a = Math.abs(d);
  if (a < 45) return "just now";
  if (a < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(d / 3600), "hour");
  if (a < 7 * 86400) return rtf.format(Math.round(d / 86400), "day");
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined): string {
  const t = toMillis(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "–";
}

export function formatDateTime(iso: string | null | undefined): string {
  const t = toMillis(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "–";
}
