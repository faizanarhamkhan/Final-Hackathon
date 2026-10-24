// Calendar helpers. Dates are plain 'YYYY-MM-DD' strings in the company time zone;
// arithmetic is done in UTC so there are no DST surprises.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseISO(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function formatISO(dt) {
  return dt.toISOString().slice(0, 10);
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = parseISO(s);
  return !Number.isNaN(dt.getTime()) && formatISO(dt) === s;
}

export function addDays(d, n) {
  const dt = parseISO(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatISO(dt);
}

export const dayOfWeek = (d) => parseISO(d).getUTCDay();

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { start: `${ym}-01`, end: formatISO(new Date(Date.UTC(y, m, 0))) };
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function prettyDate(d) {
  const dt = parseISO(d);
  return `${WEEKDAYS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCFullYear()}`;
}

export const minDate = (a, b) => (a <= b ? a : b);
export const maxDate = (a, b) => (a >= b ? a : b);

export function timeToSeconds(t) {
  const [h, m, s = 0] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

// The clock can be pinned in tests.
let fixedNow = null;
export function setNow(value) {
  fixedNow = value ? new Date(value) : null;
}
export function now() {
  return fixedNow ? new Date(fixedNow) : new Date();
}

// Current local date and time in the given IANA time zone.
export function zonedNow(timeZone, at = now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return { date, time, month: date.slice(0, 7), iso: at.toISOString() };
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Monday-based week containing d.
export function weekRange(d) {
  const dow = dayOfWeek(d);
  const start = addDays(d, dow === 0 ? -6 : 1 - dow);
  return { start, end: addDays(start, 6) };
}
