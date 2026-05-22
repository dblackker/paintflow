import type { Env } from '../types';

type EmailAttachment = {
  filename: string;
  content: string;
  type?: string;
};

type SendEmailOptions = {
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  text?: string;
};

function fromEmail(env: Env, override?: string) {
  return override || env.EMAIL_FROM || 'estimates@paintflow.app';
}

function fromName(env: Env, override?: string) {
  return override || env.EMAIL_FROM_NAME || 'PaintFlow';
}

function plainTextFromHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attachmentType(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    csv: 'text/csv',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    json: 'application/json',
    pdf: 'application/pdf',
    png: 'image/png',
    txt: 'text/plain',
  };
  return (ext && types[ext]) || 'application/octet-stream';
}

async function sendViaMailChannels(
  env: Env,
  to: string,
  subject: string,
  html: string,
  attachment?: EmailAttachment,
  options: SendEmailOptions = {}
) {
  if (!env.MAILCHANNELS_API_KEY) {
    throw new Error('MAILCHANNELS_API_KEY is not configured');
  }

  const personalization: Record<string, unknown> = {
    to: [{ email: to }],
  };

  const payload: Record<string, unknown> = {
    personalizations: [personalization],
    from: {
      email: fromEmail(env, options.fromEmail),
      name: fromName(env, options.fromName),
    },
    subject,
    content: [
      { type: 'text/plain', value: options.text || plainTextFromHtml(html) },
      { type: 'text/html', value: html },
    ],
  };

  if (options.replyTo) {
    payload.reply_to = { email: options.replyTo };
  }

  if (attachment) {
    payload.attachments = [{
      filename: attachment.filename,
      type: attachment.type || attachmentType(attachment.filename),
      content: attachment.content,
    }];
  }

  const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': env.MAILCHANNELS_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('MailChannels error:', error);
    throw new Error('Failed to send email');
  }

  return response.status === 202 ? { success: true } : await response.json().catch(() => ({ success: true }));
}

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  attachment?: EmailAttachment,
  options: SendEmailOptions = {}
) {
  return sendViaMailChannels(env, to, subject, html, attachment, options);
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
