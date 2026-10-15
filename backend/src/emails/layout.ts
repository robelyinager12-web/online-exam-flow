export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
            ${bodyHtml}
            <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">ExamFlow &middot; If you did not expect this email, you can ignore it.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export const renderButton = (url: string, label: string): string =>
  `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">${escapeHtml(label)}</a></p>
   <p style="font-size:13px;color:#6b7280;">If the button does not work, copy this link into your browser:<br>${escapeHtml(url)}</p>`;