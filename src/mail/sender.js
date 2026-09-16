// Actually delivers one email — either over real SMTP or, under
// MAIL_MODE=console (dev, §9.2), just printed to stdout instead. This is
// the only place that ever touches SMTP credentials or a message body.
//
// §12.6: production logs must never carry a link or message body, only
// "sent to X: ok/fail" — see the worker, which is what actually logs.
// MAIL_MODE=console is the one deliberate exception: its whole point is to
// let a developer read the email that would have been sent, and it is
// never the mode used in production (SMTP must be configured there).

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, body }) {
  if (env.mailMode === 'console') {
    console.log(`[mail:console] to=${to}\nsubject: ${subject}\n${body}\n`);
    return;
  }
  await getTransporter().sendMail({ from: env.smtp.from, to, subject, text: body });
}
