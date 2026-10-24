import { addDays, dayOfWeek, isISODate } from '../../lib/dates.js';

// Offline parser for leave requests written in plain English or Roman Urdu.
// Used when no AI key is configured or the AI provider fails.

const WEEKDAY_WORDS = {
  sunday: 0, sun: 0, itwar: 0, itwaar: 0,
  monday: 1, mon: 1, peer: 1, pir: 1, somwar: 1,
  tuesday: 2, tue: 2, tues: 2, mangal: 2, mangalwar: 2,
  wednesday: 3, wed: 3, budh: 3, budhwar: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, jumeraat: 4, jumerat: 4,
  friday: 5, fri: 5, jumma: 5, juma: 5,
  saturday: 6, sat: 6, hafta: 6, sanichar: 6,
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, aik: 1, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5 };

const TYPE_KEYWORDS = [
  ['sick', /\b(sick|ill|illness|fever|flu|doctor|hospital|medical|unwell|surgery|dentist|bemar|bimar|beemar|tabiyat|tabiat)\b/],
  ['unpaid', /\b(unpaid|without pay|no pay|bina tankhwa)\b/],
  ['annual', /\b(annual|vacation|holiday trip|trip|travel|tour|umrah|hajj|vacations)\b/],
  ['casual', /\b(casual|wedding|marriage|shaadi|shadi|mehndi|barat|walima|family|personal|errand|function|event|funeral)\b/],
];

export function guessLeaveType(text, codes) {
  const t = text.toLowerCase();
  for (const [code, re] of TYPE_KEYWORDS) if (re.test(t) && codes.includes(code)) return code;
  return codes.includes('casual') ? 'casual' : codes[0];
}

// Next occurrence of a weekday strictly after `after` (or on it when inclusive).
function nextWeekday(after, dow, inclusive = false) {
  let d = inclusive ? after : addDays(after, 1);
  while (dayOfWeek(d) !== dow) d = addDays(d, 1);
  return d;
}

function makeDate(year, month, day, today) {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isISODate(iso)) return null;
  // "5 Jan" said in December means next year.
  if (iso < addDays(today, -60) && year === Number(today.slice(0, 4))) return makeDate(year + 1, month, day, today);
  return iso;
}

export function extractDates(text, today) {
  const t = ` ${text.toLowerCase().replace(/[,]/g, ' ')} `;
  const found = [];
  const push = (index, date) => date && found.push({ index, date });
  const year = Number(today.slice(0, 4));
  let m;

  const iso = /\b(\d{4}-\d{2}-\d{2})\b/g;
  while ((m = iso.exec(t))) if (isISODate(m[1])) push(m.index, m[1]);

  const dm = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g;
  while ((m = dm.exec(t))) {
    if (/\d{4}-\d{2}-\d{2}/.test(t.slice(m.index - 5, m.index + 10))) continue;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    push(m.index, makeDate(y, Number(m[2]), Number(m[1]), today));
  }

  const monthAlt = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthAlt}\\b`, 'g');
  while ((m = dayMonth.exec(t))) push(m.index, makeDate(year, MONTHS.indexOf(m[2].slice(0, 3)) + 1, Number(m[1]), today));
  const monthDay = new RegExp(`\\b${monthAlt}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g');
  while ((m = monthDay.exec(t))) push(m.index, makeDate(year, MONTHS.indexOf(m[1].slice(0, 3)) + 1, Number(m[2]), today));

  const rel = [
    [/\b(day after tomorrow|parson|parso|parsoon)\b/g, 2],
    [/\b(tomorrow|tmrw|tomorow|kal)\b/g, 1],
    [/\b(today|aaj|aj)\b/g, 0],
  ];
  const taken = [];
  for (const [re, offset] of rel) {
    while ((m = re.exec(t))) {
      if (taken.some(([a, b]) => m.index >= a && m.index < b)) continue;
      taken.push([m.index, m.index + m[0].length]);
      push(m.index, addDays(today, offset));
    }
  }

  // Weekdays: each one is the first occurrence after the previous weekday mentioned,
  // so "next Monday and Tuesday" gives two consecutive days.
  const wd = new RegExp(`\\b(${Object.keys(WEEKDAY_WORDS).join('|')})\\b`, 'g');
  let anchor = today;
  const weekdays = [];
  while ((m = wd.exec(t))) {
    // "hafta" also means "week" in Urdu ("agle hafte"); only treat it as Saturday when not preceded by agle/is.
    if (m[1] === 'hafta' && /(agle|agla|is|iss)\s+$/.test(t.slice(0, m.index))) continue;
    weekdays.push(m);
  }
  for (const w of weekdays) {
    const d = nextWeekday(anchor, WEEKDAY_WORDS[w[1]], anchor !== today);
    push(w.index, d);
    anchor = d;
  }

  if (!found.length && /\b(next week|agle hafte|agla hafta|coming week)\b/.test(t)) {
    const mon = nextWeekday(today, 1);
    push(0, mon);
    push(1, addDays(mon, 4));
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.date);
}

function durationDays(text) {
  const t = text.toLowerCase();
  const m = t.match(/\bfor\s+(\d{1,2}|[a-z]+)\s+(?:working\s+)?days?\b/) || t.match(/\b(\d{1,2}|[a-z]+)\s+(?:din|days?)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return n && n > 0 && n <= 60 ? n : null;
}

function extractReason(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  const m = clean.match(/\b(?:for|because of|because|due to|kyun ke|kyunke|ki wajah se)\s+(?!\d+\s+days?)(?:a |an |the )?(.+)$/i);
  let reason = m ? m[1] : clean;
  reason = reason.replace(/[.!?]+$/, '').trim();
  return (reason.charAt(0).toUpperCase() + reason.slice(1)).slice(0, 200) || 'Personal';
}

/** Returns { type, start_date, end_date, reason } or null when no date could be found. */
export function parseLeaveText(text, today, codes, isWorking = () => true) {
  const dates = extractDates(text, today);
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const start = sorted[0];
  let end = sorted[sorted.length - 1];
  const n = durationDays(text);
  if (n && dates.length === 1) {
    // "from Monday for 3 days" = three working days starting Monday.
    let d = start;
    let counted = isWorking(d) ? 1 : 0;
    while (counted < n) {
      d = addDays(d, 1);
      if (isWorking(d)) counted++;
    }
    end = d;
  }
  return { type: guessLeaveType(text, codes), start_date: start, end_date: end, reason: extractReason(text) };
}

export function looksLikeLeaveRequest(text) {
  const t = text.toLowerCase();
  return (
    /\b(leave|off|chutti|chhutti|chuti|absent|day off|time off|vacation|holiday)\b/.test(t) &&
    /\b(need|want|take|apply|request|chahiye|chahye|lena|leni|book|give me|i'll be|i will be|can i)\b/.test(t)
  );
}
