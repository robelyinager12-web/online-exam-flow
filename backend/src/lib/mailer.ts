import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Without SMTP settings (local development) nothing is sent: the message is written to the log,
// so you can copy the verification or reset link from the terminal.
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export async function sendMail(message: MailMessage): Promise<void> {
  await transporter.sendMail({ from: env.MAIL_FROM, ...message });
  if (!env.SMTP_HOST) {
    logger.info({ to: message.to, subject: message.subject }, `Email not sent (SMTP not configured):\n${message.text}`);
  }
}

// Fire and forget. Responses must not wait for the mail server, otherwise response time
// would reveal whether an email address exists.
export function sendMailInBackground(message: MailMessage): void {
  sendMail(message).catch((err) => {
    logger.error({ err, to: message.to, subject: message.subject }, 'Failed to send email');
  });
}