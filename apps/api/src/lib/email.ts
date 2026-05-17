export async function sendEmail(env: any, to: string, subject: string, html: string, attachment?: { filename: string; content: string }) {
  const payload: any = {
    from: 'PaintFlow <estimates@paintflow.app>',
    to: [to],
    subject,
    html,
  };
  
  if (attachment) {
    payload.attachments = [
      {
        filename: attachment.filename,
        content: attachment.content,
      },
    ];
  }
  
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!res.ok) {
    const error = await res.text();
    console.error('Resend error:', error);
    throw new Error('Failed to send email');
  }
  
  return await res.json();
}

export function estimateEmailTemplate(estimateId: string, leadName: string, total: string) {
  const url = `https://paintflow.app/estimates/${estimateId}`;
  
  return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2563eb;">Your Painting Estimate is Ready</h1>
  <p>Hi ${leadName},</p>
  <p>We've prepared a detailed estimate for your painting project.</p>
  <p><strong>Total: $${total}</strong></p>
  <p>View and accept your estimate online:</p>
  <a href="${url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">View Estimate</a>
  <p>This estimate is valid for 30 days.</p>
  <p>Questions? Just reply to this email.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #6b7280; font-size: 14px;">PaintFlow - Professional Painting Estimates</p>
</body>
</html>
  `;
}
