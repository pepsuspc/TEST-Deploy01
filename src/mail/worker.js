// Drains the email queue (§9.2: "ส่งอีเมลห้ามบล็อกการกดปุ่ม") and runs the
// once-daily 08:00 Asia/Bangkok overdue digest (§9.1's last row). Both are
// driven by a plain `setInterval` from server.js — no cron dependency,
// matching §3.5 ("ไม่ใช้บริการเสียเงินเพิ่ม").

import { dueEmails, markSent, markRetry, markFailed } from '../models/emailQueue.js';
import { sendMail } from './sender.js';
import { bangkokDateKey, bangkokHour } from '../domain/thaiDate.js';
import { getGlobalSettings, setLastDigestDate } from '../models/settings.js';
import { runOverdueDigest } from './digest.js';

// §9.2: "ล้มเหลว retry 3 ครั้ง ห่าง 1/5/15 นาที แล้ว mark failed"
const RETRY_DELAYS_MIN = [1, 5, 15];

export async function processEmailQueue(now = new Date()) {
  const due = await dueEmails(now);
  for (const email of due) {
    try {
      await sendMail(email);
      await markSent(email._id, now);
      // §12.6: never log recipient's message content/link — only the outcome.
      console.log(`[mail] sent to=${email.to}: ok`);
    } catch (err) {
      const attempts = email.attempts + 1;
      if (attempts > RETRY_DELAYS_MIN.length) {
        await markFailed(email._id, attempts, err);
        console.log(`[mail] sent to=${email.to}: failed (giving up after ${attempts} attempts)`);
      } else {
        const nextAttemptAt = new Date(now.getTime() + RETRY_DELAYS_MIN[attempts - 1] * 60 * 1000);
        await markRetry(email._id, attempts, nextAttemptAt, err);
        console.log(`[mail] sent to=${email.to}: failed (retry ${attempts}/${RETRY_DELAYS_MIN.length})`);
      }
    }
  }
}

// Checked every few minutes; fires at most once per Bangkok calendar day,
// tracked in `settings` (survives process restarts near 08:00 so a reboot
// right at 08:01 doesn't skip the digest or send it twice).
export async function runOverdueDigestIfDue(now = new Date()) {
  if (bangkokHour(now) !== 8) return;
  const todayKey = bangkokDateKey(now);
  const settings = await getGlobalSettings();
  if (settings.lastOverdueDigestDate === todayKey) return;
  await runOverdueDigest(now);
  await setLastDigestDate(todayKey);
}
