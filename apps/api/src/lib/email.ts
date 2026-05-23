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

function emailProvider(env: Env) {
  if (env.EMAIL_PROVIDER) return env.EMAIL_PROVIDER;
  if (env.MAILCHANNELS_API_KEY) return 'mailchannels';
  if (env.RESEND_API_KEY) return 'resend';
  return 'mailchannels';
}

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

async function sendViaResend(
  env: Env,
  to: string,
  subject: string,
  html: string,
  attachment?: EmailAttachment,
  options: SendEmailOptions = {}
) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const payload: Record<string, unknown> = {
    from: `${fromName(env, options.fromName)} <${fromEmail(env, options.fromEmail)}>`,
    to: [to],
    subject,
    html,
  };

  if (options.replyTo) payload.reply_to = options.replyTo;
  if (attachment) {
    payload.attachments = [{
      filename: attachment.filename,
      content: attachment.content,
    }];
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Resend error:', error);
    throw new Error('Failed to send email');
  }

  return await response.json();
}

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  attachment?: EmailAttachment,
  options: SendEmailOptions = {}
) {
  return emailProvider(env) === 'resend'
    ? sendViaResend(env, to, subject, html, attachment, options)
    : sendViaMailChannels(env, to, subject, html, attachment, options);
}

type EstimateEmailInput = {
  estimateId: string;
  leadName: string;
  total: string;
  baseUrl?: string;
  companyName?: string;
  estimatorName?: string | null;
  estimatorEmail?: string | null;
  estimatorPhone?: string | null;
  estimateType?: string | null;
  scopeSummary?: Array<{
    space: string;
    substrates: string[];
  }>;
};

type EmailTemplateDefinition = {
  key: string;
  name: string;
  category: 'estimate' | 'change_order' | 'drip' | 'review' | 'system';
  channel: 'transactional' | 'marketing' | 'operational';
  subject: string;
  preheader: string;
  intro: string;
  cta: string;
  outro: string;
};

export type RenderedEmail = {
  templateKey: string;
  templateName: string;
  channel: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

export const estimateEmailTemplates: Record<string, EmailTemplateDefinition> = {
  'estimate.interior.sent': {
    key: 'estimate.interior.sent',
    name: 'Interior estimate ready',
    category: 'estimate',
    channel: 'transactional',
    subject: '{{companyName}} interior painting proposal for {{leadName}}',
    preheader: 'Review your interior painting scope, paint selections, total, and approval link.',
    intro: '{{companyName}} has prepared your interior painting proposal. The proposal is organized by room or space so you can quickly confirm the walls, ceilings, trim, doors, coats, and paint selections.',
    cta: 'Review and approve proposal',
    outro: 'If a room, color, or substrate needs to change, reply to this email before approving so the estimate can be updated cleanly.',
  },
  'estimate.exterior.sent': {
    key: 'estimate.exterior.sent',
    name: 'Exterior estimate ready',
    category: 'estimate',
    channel: 'transactional',
    subject: '{{companyName}} exterior painting proposal for {{leadName}}',
    preheader: 'Review your exterior scope, substrates, paint selections, total, and approval link.',
    intro: '{{companyName}} has prepared your exterior painting proposal. The proposal highlights the included substrates, prep expectations, coats, and paint selections so the scope is clear before work is scheduled.',
    cta: 'Review and approve proposal',
    outro: 'If exterior access, repairs, colors, or optional areas need to change, reply to this email before approving so the estimate can be updated cleanly.',
  },
  'estimate.standard.sent': {
    key: 'estimate.standard.sent',
    name: 'Painting estimate ready',
    category: 'estimate',
    channel: 'transactional',
    subject: 'Painting proposal from {{companyName}}',
    preheader: 'Review your painting scope, paint selections, total, and approval link.',
    intro: '{{companyName}} has prepared your painting proposal for review. The secure proposal link includes the current scope, optional add-ons, approval, signature, and deposit steps.',
    cta: 'Review and approve proposal',
    outro: 'If anything in the scope should change, reply to this email before approving so everyone is working from the current version.',
  },
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
  return renderEstimateEmail(input).html;
}

function replaceMergeTags(value: string, fields: Record<string, string>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => fields[key] || '');
}

function estimateTemplateKey(input: EstimateEmailInput) {
  const type = String(input.estimateType || '').toLowerCase();
  if (type.includes('interior')) return 'estimate.interior.sent';
  if (type.includes('exterior')) return 'estimate.exterior.sent';
  return 'estimate.standard.sent';
}

export function renderEstimateEmail(input: EstimateEmailInput): RenderedEmail {
  const template = estimateEmailTemplates[estimateTemplateKey(input)] || estimateEmailTemplates['estimate.standard.sent'];
  const baseUrl = input.baseUrl || 'https://app.paintflow.app';
  const url = `${baseUrl}/estimates/${encodeURIComponent(input.estimateId)}`;
  const companyName = escapeHtml(input.companyName || 'your painting contractor');
  const leadName = escapeHtml(input.leadName);
  const total = escapeHtml(input.total);
  const estimatorName = escapeHtml(input.estimatorName || input.companyName || 'Your estimator');
  const estimatorEmail = input.estimatorEmail ? escapeHtml(input.estimatorEmail) : '';
  const estimatorPhone = input.estimatorPhone ? escapeHtml(input.estimatorPhone) : '';
  const scopeSummary = Array.isArray(input.scopeSummary) ? input.scopeSummary.slice(0, 8) : [];
  const mergeFields = {
    companyName: input.companyName || 'your painting contractor',
    leadName: input.leadName,
    total: input.total,
    estimatorName: input.estimatorName || input.companyName || 'Your estimator',
  };
  const subject = replaceMergeTags(template.subject, mergeFields);
  const intro = replaceMergeTags(template.intro, mergeFields);
  const outro = replaceMergeTags(template.outro, mergeFields);
  const scopeHtml = scopeSummary.length ? `
  <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; margin: 18px 0;">
    <h2 style="font-size: 16px; margin: 0 0 10px; color: #111827;">Included scope summary</h2>
    ${scopeSummary.map((group) => `
      <div style="padding: 8px 0; border-top: 1px solid #f3f4f6;">
        <strong>${escapeHtml(group.space)}</strong>
        <div style="color: #4b5563; font-size: 14px; margin-top: 3px;">${group.substrates.map(escapeHtml).join(', ')}</div>
      </div>
    `).join('')}
  </div>
  ` : '';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2563eb;">Your painting proposal is ready</h1>
  <p>Hi ${leadName},</p>
  <p>${escapeHtml(intro)}</p>
  <p><strong>Base proposal total: $${total}</strong></p>
  ${scopeHtml}
  <p>Use the secure link below to review the included scope, choose any optional add-ons, approve the proposal, sign, and pay the deposit.</p>
  <a href="${url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">${escapeHtml(template.cta)}</a>
  <p style="color: #4b5563;">A PDF copy can be provided for your records, but approvals, selected options, signatures, and deposits should happen through the secure proposal link so everyone is working from the current version.</p>
  <p>This proposal is valid for 30 days unless otherwise noted.</p>
  <p>${escapeHtml(outro)}</p>
  <p>Questions? Reply to this email${estimatorPhone ? ` or call ${estimatorPhone}` : ''}.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #6b7280; font-size: 14px;">Sent by ${estimatorName}${estimatorEmail ? ` &lt;${estimatorEmail}&gt;` : ''}</p>
</body>
</html>
  `;

  return {
    templateKey: template.key,
    templateName: template.name,
    channel: template.channel,
    subject,
    preheader: template.preheader,
    html,
    text: plainTextFromHtml(html),
  };
}
