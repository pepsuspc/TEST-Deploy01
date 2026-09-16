// "รอมาแล้ว ..." — how long something has been waiting (§8.6). Pure
// function of two Dates; nothing here is stored in the DB because it would
// go stale immediately (§8.6: "ค่าทั้งหมดคำนวณตอนแสดง ไม่เก็บลง DB").

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY; // §8.6's own bucket boundary, not a calendar month
const YEAR = 365 * DAY;

export function humanizeDuration(fromDate, toDate = new Date()) {
  const ms = Math.max(0, toDate.getTime() - fromDate.getTime());

  if (ms < MINUTE) return 'เมื่อสักครู่';

  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    return `${minutes} นาที`;
  }

  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return `${hours} ชั่วโมง ${minutes} นาที`;
  }

  if (ms < MONTH) {
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    return `${days} วัน ${hours} ชั่วโมง`;
  }

  if (ms < YEAR) {
    const months = Math.floor(ms / MONTH);
    const days = Math.floor((ms % MONTH) / DAY);
    return `${months} เดือน ${days} วัน`;
  }

  const years = Math.floor(ms / YEAR);
  const months = Math.floor((ms % YEAR) / MONTH);
  return `${years} ปี ${months} เดือน`;
}

// "รอมาแล้ว 25 นาที" — the label as shown in the inbox/detail page.
export function humanizeWaited(fromDate, toDate = new Date()) {
  return `รอมาแล้ว ${humanizeDuration(fromDate, toDate)}`;
}
