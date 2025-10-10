// lib/mailer.js
import nodemailer from "nodemailer";

export function makeTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendMail({
  to,
  cc, // ✅ new
  bcc, // ✅ new
  subject,
  html,
  text,
  attachments = [],
}) {
  const transporter = makeTransport();
  const info = await transporter.sendMail({
    from:
      process.env.MAIL_FROM || '"IT Jobs Factory" <no-reply@itjobsfactory.com>',
    to,
    cc, // ✅ pass-through
    bcc, // ✅ pass-through
    subject,
    html,
    text,
    attachments,
    replyTo: process.env.MAIL_REPLY_TO || undefined, // optional nice touch
  });
  return info;
}
