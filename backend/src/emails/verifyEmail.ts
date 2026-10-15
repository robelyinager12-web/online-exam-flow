import { escapeHtml, renderButton, renderLayout, type EmailContent } from './layout';

export function verifyEmailEmail(input: { firstName: string; url: string }): EmailContent {
  const subject = 'Verify your ExamFlow email address';
  const html = renderLayout(
    'Verify your email',
    `<p>Hello ${escapeHtml(input.firstName)},</p>
     <p>Thanks for registering. Please confirm your email address to activate your account. This link is valid for 24 hours.</p>
     ${renderButton(input.url, 'Verify email')}`,
  );
  const text = `Hello ${input.firstName},\n\nPlease verify your email address to activate your ExamFlow account (valid for 24 hours):\n${input.url}\n`;
  return { subject, html, text };
}