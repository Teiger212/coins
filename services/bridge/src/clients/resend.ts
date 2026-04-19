export interface ResendConfig {
  apiKey: string;
  from: string;
}

export class ResendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export class ResendClient {
  constructor(private readonly cfg: ResendConfig) {}

  /** POST https://api.resend.com/emails */
  async send(args: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<{ id: string }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.cfg.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new ResendError("send failed", res.status, text);
    const data = JSON.parse(text) as { id: string };
    return { id: data.id };
  }
}

/**
 * Hebrew magic-link email template. Keep inline CSS only — many clients strip
 * <style> blocks. No external assets.
 */
export function magicLinkEmailHtml(args: {
  magicLinkUrl: string;
  expiresAt: string;
  courseTitle?: string;
  brandName?: string;
}): { subject: string; html: string } {
  const expires = new Date(args.expiresAt);
  const expiresHe = expires.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const brand = args.brandName ?? "חופשי";
  const courseLine = args.courseTitle
    ? `<p style="margin:0 0 16px 0; color:#1F1A15; font-size:16px; line-height:1.55;">תודה שנרשמת לקורס <strong>${escapeHtml(args.courseTitle)}</strong>.</p>`
    : "";
  const subject = `${brand} — קישור הכניסה שלך לקורס`;
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#F7F3EC; font-family: 'Heebo', -apple-system, BlinkMacSystemFont, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EC; padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; padding:40px 32px; max-width:560px;">
          <tr><td style="text-align:right;">
            <h1 style="margin:0 0 16px 0; color:#1F1A15; font-size:24px; font-weight:600; line-height:1.3;">ברוכה הבאה</h1>
            ${courseLine}
            <p style="margin:0 0 24px 0; color:#1F1A15; font-size:16px; line-height:1.55;">לחצי על הכפתור כדי להיכנס לאזור האישי ולהתחיל:</p>
            <p style="margin:0 0 24px 0;">
              <a href="${args.magicLinkUrl}" style="display:inline-block; background-color:#B56A38; color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:8px; font-size:16px; font-weight:500;">כניסה לקורס</a>
            </p>
            <p style="margin:0 0 8px 0; color:#6B6560; font-size:14px; line-height:1.55;">הקישור בתוקף עד ${escapeHtml(expiresHe)}.</p>
            <p style="margin:0 0 16px 0; color:#6B6560; font-size:14px; line-height:1.55;">אם הכפתור לא עובד, העתיקי את הקישור הבא:<br/>
              <span style="word-break:break-all; color:#88997A;">${escapeHtml(args.magicLinkUrl)}</span>
            </p>
            <hr style="border:none; border-top:1px solid #EDE6DC; margin:24px 0;" />
            <p style="margin:0; color:#6B6560; font-size:13px; line-height:1.55;">אם הקישור פג, אפשר לבקש חדש בכל רגע בעמוד הכניסה.</p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function refundEmailHtml(args: {
  courseTitle?: string;
  brandName?: string;
}): { subject: string; html: string } {
  const brand = args.brandName ?? "חופשי";
  const courseLine = args.courseTitle
    ? `עבור הקורס <strong>${escapeHtml(args.courseTitle)}</strong>`
    : "";
  const subject = `${brand} — אישור ביטול וזיכוי`;
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="margin:0; padding:0; background-color:#F7F3EC; font-family:'Heebo',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EC; padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; padding:40px 32px; max-width:560px;">
        <tr><td style="text-align:right;">
          <h1 style="margin:0 0 16px 0; color:#1F1A15; font-size:24px; font-weight:600;">הבקשה שלך לביטול התקבלה</h1>
          <p style="margin:0 0 16px 0; color:#1F1A15; font-size:16px; line-height:1.55;">הגישה לקורס ${courseLine} הוסרה, והזיכוי יופיע באמצעי התשלום שלך בימים הקרובים.</p>
          <p style="margin:0; color:#6B6560; font-size:14px; line-height:1.55;">אם יש שאלה — אפשר להשיב למייל הזה ונחזור אלייך.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}
