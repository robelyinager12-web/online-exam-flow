import { escapeHtml, renderButton, renderLayout, type EmailContent } from './layout';

export function resetPasswordEmail(input: { firstName: string; url: string }): EmailContent {
  const subject = 'Reset your ExamFlow password';
  const html = renderLayout(
    'Reset your password',
    `<p>Hello ${escapeHtml(input.firstName)},</p>
     <p>We received a request to reset your password. This link is valid for 1 hour. If you did not ask for this, you can safely ignore this email and your password will stay the same.</p>
     ${renderButton(input.url, 'Choose a new password')}`,
  );
  const text = `Hello ${input.firstName},\n\nUse this link to reset your ExamFlow password (valid for 1 hour):\n${input.url}\n\nIf you did not request this, ignore this email.\n`;
  return { subject, html, text };
}