// Thai calendar/formatting helpers (§3.6). Always compute against the
// Asia/Bangkok wall-clock date, not the server process's local timezone —
// inside Docker that's usually UTC, which would flip the "year" and the
// displayed date around midnight Bangkok time.

const BANGKOK_TZ = 'Asia/Bangkok';

export function buddhistYear(date = new Date(), timeZone = BANGKOK_TZ) {
  const gregorianYear = Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date));
  return gregorianYear + 543;
}

// "14 ก.ย. 2569" — the format §3.6 picks (the doc allows either that or
// 14/09/2569; we standardize on this one everywhere).
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export function formatThaiDate(date, { withTime = false, timeZone = BANGKOK_TZ } = {}) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = get('day');
  const month = THAI_MONTHS_SHORT[Number(get('month')) - 1];
  const year = Number(get('year')) + 543;
  const datePart = `${day} ${month} ${year}`;
  if (!withTime) return datePart;
  return `${datePart} ${get('hour')}:${get('minute')}`;
}
