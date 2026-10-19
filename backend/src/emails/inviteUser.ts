import { escapeHtml, renderButton, renderLayout, type EmailContent } from './layout';

export function inviteUserEmail(input: {
  firstName: string;
  institutionName: string | null;
  url: string;
}): EmailContent {
  const where = input.institutionName ? ` at ${input.institutionName}` : '';
  const subject = `You have been invited to ExamFlow${where}`;
  const html = renderLayout(
    'Welcome to ExamFlow',
    `<p>Hello ${escapeHtml(input.firstName)},</p>
     <p>An account has been created for you${escapeHtml(where)}. Choose a password to activate it. This link is valid for 3 days.</p>
     ${renderButton(input.url, 'Set my password')}`,
  );
  const text = `Hello ${input.firstName},\n\nAn account has been created for you${where}. Choose a password to activate it (link valid for 3 days):\n${input.url}\n`;
  return { subject, html, text };
}