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

type EstimateEmailInput = {
  estimateId: string;
  leadName: string;
  total: string;
  baseUrl?: string;
  companyName?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

export function estimateEmailTemplate(input: EstimateEmailInput) {
  const baseUrl = input.baseUrl || 'https://app.paintflow.app';
  const url = `${baseUrl}/estimates/${encodeURIComponent(input.estimateId)}`;
  const companyName = escapeHtml(input.companyName || 'your painting contractor');
  const leadName = escapeHtml(input.leadName);
  const total = escapeHtml(input.total);
  
  return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2563eb;">Your painting proposal is ready</h1>
  <p>Hi ${leadName},</p>
  <p>${companyName} has prepared your painting proposal for review.</p>
  <p><strong>Base proposal total: $${total}</strong></p>
  <p>Use the secure link below to review the included scope, choose any optional add-ons, approve the proposal, sign, and pay the deposit.</p>
  <a href="${url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Review and approve proposal</a>
  <p style="color: #4b5563;">A PDF copy can be provided for your records, but approvals, selected options, signatures, and deposits should happen through the secure proposal link so everyone is working from the current version.</p>
  <p>This proposal is valid for 30 days unless otherwise noted.</p>
  <p>Questions? Just reply to this email.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #6b7280; font-size: 14px;">PaintFlow - Professional Painting Estimates</p>
</body>
</html>
  `;
}
