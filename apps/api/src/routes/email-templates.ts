import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { emailTemplates } from '@paintflow/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { estimateEmailTemplates } from '../lib/email';

const emailTemplatesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
emailTemplatesRoute.use('*', authMiddleware);

const templateSchema = z.object({
  key: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80).default('estimate'),
  channel: z.string().trim().min(1).max(50).default('transactional'),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional().nullable(),
  subject: z.string().trim().min(1).max(255),
  preheader: z.string().trim().max(255).optional().nullable(),
  html: z.string().trim().min(1),
  text: z.string().trim().optional().nullable(),
  isActive: z.boolean().default(true),
}).strict();

const templatePatchSchema = templateSchema.partial().omit({ key: true }).extend({
  isActive: z.boolean().optional(),
}).strict();

function systemTemplates() {
  return Object.values(estimateEmailTemplates).map((template) => ({
    id: null,
    source: 'system',
    key: template.key,
    category: template.category,
    channel: template.channel,
    name: template.name,
    description: 'PaintFlow default template. Create an org override to customize copy.',
    subject: template.subject,
    preheader: template.preheader,
    html: [
      '<!DOCTYPE html>',
      '<html>',
      '<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">',
      '<h1 style="color: #2563eb;">Your painting proposal is ready</h1>',
      '<p>Hi {{leadName}},</p>',
      `<p>${template.intro}</p>`,
      '<p><strong>Base proposal total: ${{total}}</strong></p>',
      '{{scopeSummaryHtml}}',
      '<p>Use the secure link below to review the included scope, choose any optional add-ons, approve the proposal, sign, and pay the deposit.</p>',
      `<a href="{{proposalUrl}}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">${template.cta}</a>`,
      '<p style="color: #4b5563;">A PDF copy can be provided for your records, but approvals, selected options, signatures, and deposits should happen through the secure proposal link so everyone is working from the current version.</p>',
      `<p>${template.outro}</p>`,
      '<p>Questions? Reply to this email or call {{estimatorPhone}}.</p>',
      '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">',
      '<p style="color: #6b7280; font-size: 14px;">Sent by {{estimatorName}} &lt;{{estimatorEmail}}&gt;</p>',
      '</body>',
      '</html>',
    ].join('\n'),
    text: null,
    isActive: true,
    isDefault: true,
    createdAt: null,
    updatedAt: null,
  }));
}

emailTemplatesRoute.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const custom = await db.select().from(emailTemplates).where(eq(emailTemplates.orgId, orgId));
  const customKeys = new Set(custom.map((template) => template.key));
  const data = [
    ...custom.map((template) => ({ ...template, source: 'org' })),
    ...systemTemplates().filter((template) => !customKeys.has(template.key)),
  ];
  return c.json({ data });
});

emailTemplatesRoute.post('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const parsed = templateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const data = parsed.data;
  const [template] = await db.insert(emailTemplates)
    .values({
      orgId,
      key: data.key,
      category: data.category,
      channel: data.channel,
      name: data.name,
      description: data.description || null,
      subject: data.subject,
      preheader: data.preheader || null,
      html: data.html,
      text: data.text || null,
      isActive: data.isActive,
      createdBy: userId,
      mergeFields: ['companyName', 'leadName', 'total', 'estimatorName', 'estimatorEmail', 'estimatorPhone', 'proposalUrl', 'scopeSummaryHtml'],
    })
    .onConflictDoUpdate({
      target: [emailTemplates.orgId, emailTemplates.key],
      set: {
        category: data.category,
        channel: data.channel,
        name: data.name,
        description: data.description || null,
        subject: data.subject,
        preheader: data.preheader || null,
        html: data.html,
        text: data.text || null,
        isActive: data.isActive,
        updatedAt: new Date(),
      },
    })
    .returning();

  return c.json({ data: template }, 201);
});

emailTemplatesRoute.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = templatePatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [template] = await db.update(emailTemplates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, orgId)))
    .returning();
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json({ data: template });
});

emailTemplatesRoute.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const [template] = await db.delete(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, orgId)))
    .returning();
  if (!template) return c.json({ error: 'Template not found' }, 404);
  return c.json({ data: template });
});

export default emailTemplatesRoute;
