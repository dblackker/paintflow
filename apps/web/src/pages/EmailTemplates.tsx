import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, labelize } from '@/lib/api';

interface EmailTemplate {
  id?: string | null;
  key: string;
  name?: string | null;
  category?: string | null;
  channel?: string | null;
  subject?: string | null;
  preheader?: string | null;
  html?: string | null;
  text?: string | null;
  isActive?: boolean | null;
  source?: 'system' | 'org' | string | null;
}

interface TemplateFormState {
  id: string;
  key: string;
  name: string;
  category: string;
  channel: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  isActive: boolean;
}

const newTemplateDefaults: TemplateFormState = {
  id: '',
  key: 'estimate.followup.custom',
  category: 'estimate',
  channel: 'transactional',
  name: 'Custom estimate email',
  subject: 'Painting proposal from {{companyName}}',
  preheader: 'Review your painting proposal and approval link.',
  html: '<p>Hi {{leadName}},</p>\n<p>Your proposal from {{companyName}} is ready.</p>\n<p>Total: ${{total}}</p>\n{{scopeSummaryHtml}}\n<p><a href="{{proposalUrl}}">Review and approve proposal</a></p>',
  text: '',
  isActive: true,
};

const categoryOptions = [
  { value: 'estimate', label: 'Estimate' },
  { value: 'change_order', label: 'Change order' },
  { value: 'drip', label: 'Drip' },
  { value: 'review', label: 'Review' },
  { value: 'system', label: 'System' },
];

const channelOptions = [
  { value: 'transactional', label: 'Transactional' },
  { value: 'operational', label: 'Operational' },
  { value: 'marketing', label: 'Marketing' },
];

const mergeTags = [
  { tag: '{{companyName}}', label: 'Company', categories: ['estimate', 'change_order', 'drip', 'review', 'system'] },
  { tag: '{{leadName}}', label: 'Customer', categories: ['estimate', 'change_order', 'drip', 'review', 'system'] },
  { tag: '{{total}}', label: 'Estimate total', categories: ['estimate'] },
  { tag: '{{proposalUrl}}', label: 'Proposal link', categories: ['estimate'] },
  { tag: '{{scopeSummaryHtml}}', label: 'Scope table', categories: ['estimate'] },
  { tag: '{{scopeSummaryText}}', label: 'Scope text', categories: ['estimate'] },
  { tag: '{{estimatorName}}', label: 'Estimator', categories: ['estimate', 'change_order', 'drip', 'review', 'system'] },
  { tag: '{{estimatorEmail}}', label: 'Estimator email', categories: ['estimate', 'change_order', 'drip', 'review', 'system'] },
  { tag: '{{estimatorPhone}}', label: 'Estimator phone', categories: ['estimate', 'change_order', 'drip', 'review', 'system'] },
  { tag: '{{jobName}}', label: 'Job', categories: ['change_order'] },
  { tag: '{{jobAddress}}', label: 'Jobsite', categories: ['change_order'] },
  { tag: '{{description}}', label: 'Change scope', categories: ['change_order'] },
  { tag: '{{amount}}', label: 'Change total', categories: ['change_order'] },
  { tag: '{{paymentDue}}', label: 'Payment due', categories: ['change_order'] },
  { tag: '{{portalUrl}}', label: 'Portal link', categories: ['change_order'] },
  { tag: '{{ctaText}}', label: 'CTA text', categories: ['estimate', 'change_order'] },
];

const previewData: Record<string, string> = {
  companyName: 'Golden Brush Painting',
  leadName: 'Emily Rivera',
  total: '8,740',
  estimatorName: 'Nick Martinez',
  estimatorEmail: 'nick@goldenbrush.example',
  estimatorPhone: '(415) 555-0138',
  proposalUrl: 'https://paintflow-demo.pages.dev/estimates/demo-preview',
  jobName: 'Rivera Interior Repaint',
  jobAddress: '95 South Park St, San Francisco, CA',
  description: 'Add two coats to the stairwell handrail and repaint the upstairs linen closet.',
  amount: '640',
  paymentDue: '320',
  portalUrl: 'https://paintflow-demo.pages.dev/portal/demo-change-order',
  ctaText: 'Review and approve',
  scopeSummaryHtml: [
    '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-family:Arial,sans-serif;font-size:14px;">',
    '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Living Room</strong><br>Walls, 2 coats, Sherwin-Williams Duration Matte</td></tr>',
    '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;"><strong>Kitchen</strong><br>Ceiling and trim, 2 coats, Emerald Urethane Semi-Gloss</td></tr>',
    '<tr><td style="padding:8px;"><strong>Primary Bedroom</strong><br>Walls, accent wall, and door casing</td></tr>',
    '</table>',
  ].join(''),
  scopeSummaryText: 'Living Room: walls, 2 coats. Kitchen: ceiling and trim. Primary Bedroom: walls, accent wall, and door casing.',
};

const allowedMergeTagNames = new Set(mergeTags.map((item) => item.tag.replace(/[{}]/g, '')));

function formFromTemplate(template?: EmailTemplate | null): TemplateFormState {
  if (!template) return newTemplateDefaults;
  return {
    id: template.id || '',
    key: template.key || '',
    name: template.name || '',
    category: template.category || 'estimate',
    channel: template.channel || 'transactional',
    subject: template.subject || '',
    preheader: template.preheader || '',
    html: template.html || '',
    text: template.text || '',
    isActive: template.isActive !== false,
  };
}

function renderTemplate(value: string) {
  return Object.entries(previewData).reduce((result, [key, replacement]) => {
    return result.split(`{{${key}}}`).join(replacement);
  }, value || '');
}

function unknownMergeTags(form: TemplateFormState) {
  const combined = [form.subject, form.preheader, form.html, form.text].join('\n');
  const found = new Set<string>();
  for (const match of combined.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const key = match[1];
    if (!allowedMergeTagNames.has(key)) found.add(`{{${key}}}`);
  }
  return Array.from(found).sort();
}

function previewHtml(form: TemplateFormState) {
  const body = renderTemplate(form.html || '<p>No HTML body yet.</p>');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; background: #f8fafc; color: #111827; font-family: Arial, sans-serif; }
      .shell { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
      .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 1px 2px rgba(15,23,42,.06); }
      a { color: #2563eb; font-weight: 700; }
      p { line-height: 1.55; }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">${body}</div>
    </div>
  </body>
</html>`;
}

function templateStatus(template: EmailTemplate) {
  if (template.source === 'system') return { label: 'System default', variant: 'default' as const };
  if (template.isActive === false) return { label: 'Inactive override', variant: 'danger' as const };
  return { label: 'Org override', variant: 'success' as const };
}

function TemplateSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <Card key={item} padding="sm" className="shadow-none">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem] sm:items-center">
            <div className="space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-8 animate-pulse rounded bg-gray-100" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function RecommendedStructure() {
  const items = [
    ['Transactional', 'Estimates, change orders, deposits, and approvals. Always preview when sent by a person.'],
    ['Operational', 'Daily summaries, stale follow-ups, schedule confirmations, and job readiness.'],
    ['Marketing', 'Drips, referral asks, win-back campaigns, and seasonal repaint reminders with consent controls.'],
  ];

  return (
    <Card>
      <CardHeader title="Recommended structure" />
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map(([title, copy]) => (
          <div key={title} className="rounded-lg bg-gray-50 p-3">
            <p className="pf-row-title">{title}</p>
            <p className="pf-copy mt-1">{copy}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TemplateRow({ template, onEdit }: { template: EmailTemplate; onEdit: (template: EmailTemplate) => void }) {
  const status = templateStatus(template);
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="pf-row-title">{template.name || labelize(template.key)}</p>
          <Badge variant={status.variant} size="sm">{status.label}</Badge>
          <Badge size="sm">{labelize(template.channel || 'transactional')}</Badge>
        </div>
        <p className="pf-copy mt-1">{template.subject || 'No subject set'}</p>
        <p className="pf-meta mt-1">
          {template.key}{template.preheader ? ` · ${template.preheader}` : ''}
        </p>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(template)}>
        {template.source === 'system' ? 'Customize' : 'Edit'}
      </Button>
    </div>
  );
}

export function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(newTemplateDefaults);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeMergeField, setActiveMergeField] = useState<keyof Pick<TemplateFormState, 'subject' | 'preheader' | 'html' | 'text'>>('html');
  const subjectRef = useRef<HTMLInputElement>(null);
  const preheaderRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const groupedTemplates = useMemo(() => {
    return templates.reduce<Record<string, EmailTemplate[]>>((groups, template) => {
      const key = template.category || 'other';
      groups[key] ||= [];
      groups[key].push(template);
      return groups;
    }, {});
  }, [templates]);
  const renderedSubject = useMemo(() => renderTemplate(form.subject), [form.subject]);
  const renderedPreheader = useMemo(() => renderTemplate(form.preheader), [form.preheader]);
  const renderedText = useMemo(() => renderTemplate(form.text || ''), [form.text]);
  const renderedPreviewHtml = useMemo(() => previewHtml(form), [form]);
  const invalidMergeTags = useMemo(() => unknownMergeTags(form), [form]);
  const availableMergeTags = useMemo(() => mergeTags.filter((item) => item.categories.includes(form.category)), [form.category]);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', modalOpen);
    return () => document.body.classList.remove('pf-modal-open');
  }, [modalOpen]);

  async function loadTemplates() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: EmailTemplate[] }>('/v1/email-templates');
      setTemplates(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email templates');
    } finally {
      setIsLoading(false);
    }
  }

  function openEditor(template?: EmailTemplate | null) {
    const nextTemplate = template || { ...newTemplateDefaults, source: 'org' };
    setEditingTemplate(nextTemplate);
    setForm(formFromTemplate(nextTemplate));
    setModalOpen(true);
  }

  function closeEditor() {
    if (isSaving || isDeleting) return;
    setModalOpen(false);
    setEditingTemplate(null);
  }

  function insertMergeTag(tag: string) {
    const fieldRefs = {
      subject: subjectRef,
      preheader: preheaderRef,
      html: htmlRef,
      text: textRef,
    };
    const element = fieldRefs[activeMergeField].current;
    const selectionStart = element?.selectionStart ?? null;
    const selectionEnd = element?.selectionEnd ?? null;

    setForm((current) => {
      const currentValue = String(current[activeMergeField] || '');
      const start = selectionStart ?? currentValue.length;
      const end = selectionEnd ?? currentValue.length;
      const before = currentValue.slice(0, start);
      const after = currentValue.slice(end);
      const prefix = before && !/\s$/.test(before) ? ' ' : '';
      const suffix = after && !/^\s/.test(after) ? ' ' : '';
      const nextValue = `${before}${prefix}${tag}${suffix}${after}`;
      const cursor = start + prefix.length + tag.length;

      window.requestAnimationFrame(() => {
        const nextElement = fieldRefs[activeMergeField].current;
        nextElement?.focus();
        nextElement?.setSelectionRange(cursor, cursor);
      });

      return { ...current, [activeMergeField]: nextValue };
    });
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (invalidMergeTags.length) {
      window.showToast?.(`Fix unknown merge tags before saving: ${invalidMergeTags.join(', ')}`, 'error');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        key: form.key,
        name: form.name,
        category: form.category,
        channel: form.channel,
        subject: form.subject,
        preheader: form.preheader || null,
        html: form.html,
        text: form.text || null,
        isActive: form.isActive,
      };

      if (form.id) {
        const { key, ...patch } = body;
        void key;
        await apiJson(`/v1/email-templates/${form.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(patch),
        });
      } else {
        await apiJson('/v1/email-templates', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
      }

      window.showToast?.('Email template saved', 'success');
      setModalOpen(false);
      await loadTemplates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save template', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function resetTemplate() {
    if (!form.id) return;
    const confirmed = window.confirm('Reset this template to the system default? Your organization override will be removed.');
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await apiJson(`/v1/email-templates/${form.id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Template reset to system default', 'success');
      setModalOpen(false);
      await loadTemplates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to reset template', 'error');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="pf-page-copy max-w-2xl">
          Manage customer-facing estimate emails. Direct estimate and change-order sends should be previewed before delivery, then logged on the customer profile.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button as="a" href="/settings" variant="secondary" size="sm">Settings</Button>
          <Button type="button" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={() => openEditor()}>
            New template
          </Button>
        </div>
      </div>

      <RecommendedStructure />

      {isLoading && <TemplateSkeleton />}

      {!isLoading && error && (
        <Card className="text-center">
          <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
          <p className="pf-copy mt-2 text-red-700">{error}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadTemplates}>
            Retry
          </Button>
        </Card>
      )}

      {!isLoading && !error && !templates.length && (
        <Card>
          <EmptyState
            icon={<Icon name="mail" className="h-5 w-5" />}
            title="No templates found."
            description="Start with a transactional estimate email, then add change-order and follow-up templates as the system grows."
            action={{ label: 'New template', onClick: () => openEditor() }}
          />
        </Card>
      )}

      {!isLoading && !error && templates.length > 0 && (
        <div className="space-y-3">
          {Object.entries(groupedTemplates).map(([category, items]) => (
            <Card key={category} padding="none" className="overflow-hidden">
              <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3" title={labelize(category)} />
              <CardContent className="divide-y divide-gray-200">
                {items.map((template) => (
                  <TemplateRow key={template.id || template.key} template={template} onEdit={openEditor} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-[220] flex items-end justify-center overflow-y-auto bg-black/50 p-0 pt-[calc(4.75rem+env(safe-area-inset-top))] sm:items-start sm:p-4 sm:pt-[calc(5rem+env(safe-area-inset-top))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section className="flex max-h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
            <div className="sticky top-0 z-10 border-b bg-white px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="template-modal-title" className="pf-section-title">
                    {editingTemplate?.source === 'system' ? 'Customize system template' : form.id ? 'Edit template' : 'New template'}
                  </h2>
                  <p className="pf-copy mt-1">
                    Merge tags use double braces, such as <code>{'{{leadName}}'}</code> and <code>{'{{proposalUrl}}'}</code>.
                  </p>
                </div>
                <button type="button" className="btn-icon" aria-label="Close template editor" onClick={closeEditor}>
                  <Icon name="close" className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form className="min-h-0 overflow-y-auto" onSubmit={saveTemplate}>
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
                <div className="space-y-4 px-4 py-4 sm:px-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Template key"
                      required
                      placeholder="estimate.interior.sent"
                      value={form.key}
                      disabled={Boolean(form.id)}
                      onChange={(event) => setForm({ ...form, key: event.target.value })}
                    />
                    <Input
                      label="Name"
                      required
                      placeholder="Interior estimate ready"
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Select
                      label="Category"
                      value={form.category}
                      onChange={(event) => setForm({ ...form, category: event.target.value })}
                      options={categoryOptions}
                    />
                    <Select
                      label="Channel"
                      value={form.channel}
                      onChange={(event) => setForm({ ...form, channel: event.target.value })}
                      options={channelOptions}
                    />
                    <label className="flex items-end gap-2 rounded-lg border px-3 py-2">
                      <input
                        type="checkbox"
                        className="mb-1 rounded border-gray-300"
                        checked={form.isActive}
                        onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                      />
                      <span className="pf-row-title">Active override</span>
                    </label>
                  </div>
                  <Input
                    ref={subjectRef}
                    label="Subject"
                    required
                    placeholder="{{companyName}} painting proposal for {{leadName}}"
                    value={form.subject}
                    onFocus={() => setActiveMergeField('subject')}
                    onChange={(event) => setForm({ ...form, subject: event.target.value })}
                  />
                  <Input
                    ref={preheaderRef}
                    label="Preheader"
                    maxLength={255}
                    placeholder="Short inbox preview text"
                    value={form.preheader}
                    onFocus={() => setActiveMergeField('preheader')}
                    onChange={(event) => setForm({ ...form, preheader: event.target.value })}
                  />
                  <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="pf-row-title">Merge variables</p>
                        <p className="pf-meta">Click a variable to insert it into the last field you edited.</p>
                      </div>
                      <Badge size="sm">Target: {labelize(activeMergeField)}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {availableMergeTags.map((item) => (
                        <button
                          key={item.tag}
                          type="button"
                          className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 hover:border-blue-400 hover:bg-blue-50"
                          title={item.tag}
                          onClick={() => insertMergeTag(item.tag)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {invalidMergeTags.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="pf-row-title text-red-900">Unknown merge variables</p>
                      <p className="pf-copy mt-1 text-red-800">
                        These variables will not be replaced when the email is sent: {invalidMergeTags.join(', ')}.
                      </p>
                    </div>
                  )}
                  <Textarea
                    ref={htmlRef}
                    label="HTML body"
                    className="min-h-[18rem] font-mono text-xs"
                    required
                    value={form.html}
                    onFocus={() => setActiveMergeField('html')}
                    onChange={(event) => setForm({ ...form, html: event.target.value })}
                  />
                  <Textarea
                    ref={textRef}
                    label="Plain text fallback"
                    className="min-h-28 font-mono text-xs"
                    placeholder="Optional. Generated from HTML when blank."
                    value={form.text}
                    onFocus={() => setActiveMergeField('text')}
                    onChange={(event) => setForm({ ...form, text: event.target.value })}
                  />
                  <div className="pf-meta rounded-lg bg-gray-50 p-3">
                    Available merge tags:{' '}
                    {availableMergeTags.map((item, index) => (
                      <span key={item.tag}>
                        <code>{item.tag}</code>{index < availableMergeTags.length - 1 ? ', ' : '.'}
                      </span>
                    ))}
                  </div>
                </div>
                <aside className="border-t bg-gray-50 px-4 py-4 sm:px-5 lg:border-l lg:border-t-0">
                  <div className="lg:sticky lg:top-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="pf-section-title">Live preview</p>
                        <p className="pf-copy mt-1">Rendered with sample customer, estimate, and painter data.</p>
                      </div>
                      <Badge size="sm">Sample data</Badge>
                    </div>
                    <div className="rounded-xl border bg-white shadow-sm">
                      <div className="border-b px-4 py-3">
                        <p className="pf-meta">Subject</p>
                        <p className="pf-row-title mt-1">{renderedSubject || 'No subject yet'}</p>
                        {renderedPreheader && <p className="pf-copy mt-1">{renderedPreheader}</p>}
                      </div>
                      <iframe
                        title="Email template HTML preview"
                        sandbox=""
                        srcDoc={renderedPreviewHtml}
                        className="h-[28rem] w-full rounded-b-xl bg-white"
                      />
                    </div>
                    <details className="mt-3 rounded-lg border bg-white p-3">
                      <summary className="cursor-pointer pf-row-title">Plain text preview</summary>
                      <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-gray-700">
                        {renderedText || 'Plain text fallback is blank. PaintFlow will generate a fallback from the HTML body when sending.'}
                      </pre>
                    </details>
                  </div>
                </aside>
              </div>
              <div className="mobile-sticky-actions flex flex-col gap-2 border-t bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
                {form.id && (
                  <Button type="button" variant="ghost" className="justify-center text-red-700" isLoading={isDeleting} onClick={resetTemplate}>
                    Reset to system default
                  </Button>
                )}
                <Button type="button" variant="secondary" className="justify-center" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button type="submit" className="justify-center" isLoading={isSaving} disabled={invalidMergeTags.length > 0}>
                  Save template
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
