import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { API_URL, apiJson } from '@/lib/api';

interface LeadIntakeSettings {
  orgSlug: string;
  endpointUrl: string;
  requireSecret: boolean;
  secret?: string;
  enabled: boolean;
  defaultSource: string;
  allowedDomains: string[];
}

const requestFields = [
  ['name', 'string', 'Required', 'Customer name.'],
  ['phone', 'string', 'Required if email is blank', 'Customer phone number. US numbers are normalized before saving.'],
  ['email', 'email', 'Required if phone is blank', 'Customer email address.'],
  ['streetAddress', 'string', 'Optional', 'Project street address.'],
  ['city', 'string', 'Optional', 'Project city.'],
  ['state', 'string', 'Optional', 'Project state or region.'],
  ['postalCode', 'string', 'Optional', 'Project ZIP or postal code.'],
  ['message', 'string', 'Optional', 'Customer request notes. Maximum 2,000 characters.'],
  ['source', 'string', 'Optional', 'Lead source label. Defaults to the setting configured in Crewmodo.'],
  ['sourceType', 'string', 'Optional', 'Source category, such as website, landing_page, zapier, or facebook.'],
  ['referrer', 'string', 'Optional', 'Browser referrer or marketing source URL.'],
  ['landingPage', 'string', 'Optional', 'Landing page that captured the inquiry.'],
  ['utmSource', 'string', 'Optional', 'UTM source. Can also be used as source fallback.'],
  ['utmMedium', 'string', 'Optional', 'UTM medium.'],
  ['utmCampaign', 'string', 'Optional', 'UTM campaign.'],
  ['website', 'string', 'Optional', 'Contractor website or form location.'],
  ['idempotencyKey', 'string', 'Recommended', 'Stable unique key for retries if you cannot send the Idempotency-Key header.'],
  ['company', 'string', 'Spam trap', 'Honeypot field. Leave blank for real submissions.'],
];

const responseRows = [
  ['201', 'Lead created', 'Returns { data: { id, duplicate: false } }.'],
  ['202', 'Accepted duplicate', 'Returned when the phone or email already matches an existing lead, or when the honeypot catches spam.'],
  ['400', 'Validation failed', 'Missing name, missing phone or email, invalid email, or invalid phone fallback.'],
  ['401', 'Secret required', 'The x-crewmodo-lead-secret header is missing or wrong when server secret is enabled.'],
  ['403', 'Intake blocked', 'Lead intake is disabled or the request origin is not in the allowed domain list.'],
  ['404', 'Destination not found', 'The organization slug in the URL does not exist.'],
  ['429', 'Rate limited', 'More than five submissions per minute from the same IP and organization.'],
];

function CodeBlock({ label, code }: { label: string; code: string }) {
  async function copyCode() {
    await navigator.clipboard.writeText(code);
    window.showToast?.(`${label} copied`, 'success');
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--pf-border)] bg-[var(--md-sys-color-surface-container)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--pf-border)] px-4 py-2">
        <p className="pf-meta">{label}</p>
        <button type="button" className="btn-icon btn-icon-tonal h-8 w-8" onClick={copyCode} aria-label={`Copy ${label}`}>
          <Icon name="file-text" className="h-4 w-4" />
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-6 text-[var(--md-sys-color-on-surface)] sm:text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function DocsTable({ rows, columns }: { rows: string[][]; columns: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--pf-border)]">
      <table className="min-w-full divide-y divide-[var(--pf-border)] text-left text-sm">
        <thead className="bg-[var(--md-sys-color-surface-container)]">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-medium text-[var(--md-sys-color-on-surface)]">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--pf-border)] bg-white">
          {rows.map((row) => (
            <tr key={row.join('-')}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`} className="px-4 py-3 align-top text-[var(--md-sys-color-on-surface-variant)]">
                  {index === 0 ? <code className="font-mono text-[var(--md-sys-color-on-surface)]">{cell}</code> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function markdownTable(columns: string[], rows: string[][]) {
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
}

export function LeadIntakeDocs() {
  const [settings, setSettings] = useState<LeadIntakeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      setIsLoading(true);
      setError('');
      try {
        const response = await apiJson<{ data?: LeadIntakeSettings }>('/v1/settings/lead-intake');
        if (!cancelled) setSettings(response.data || null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Lead intake settings could not be loaded');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const endpoint = settings?.endpointUrl || `${API_URL}/v1/lead-capture/{orgSlug}`;
  const curlExample = useMemo(() => `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: website-{{unique_submission_id}}"${settings?.requireSecret ? ` \\
  -H "x-crewmodo-lead-secret: {{lead_secret}}"` : ''} \\
  -d '{
    "name": "Jane Homeowner",
    "email": "jane@example.com",
    "phone": "(555) 010-0199",
    "streetAddress": "120 Oak Street",
    "city": "Bremerton",
    "state": "WA",
    "postalCode": "98310",
    "source": "Website form",
    "sourceType": "website",
    "message": "Looking for an exterior repaint estimate."
  }'`, [endpoint, settings?.requireSecret]);

  const fetchExample = useMemo(() => `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID()${settings?.requireSecret ? `,
    "x-crewmodo-lead-secret": "{{lead_secret}}"` : ''}
  },
  body: JSON.stringify({
    name: form.name.value,
    email: form.email.value,
    phone: form.phone.value,
    streetAddress: form.streetAddress.value,
    source: "Website form",
    sourceType: "website"
  })
});

if (!response.ok) {
  throw new Error("Lead submission failed");
}`, [endpoint, settings]);

  const formExample = useMemo(() => `<form id="crewmodo-lead-form">
  <label>
    Name
    <input name="name" autocomplete="name" required />
  </label>
  <label>
    Email
    <input name="email" type="email" autocomplete="email" />
  </label>
  <label>
    Phone
    <input name="phone" type="tel" autocomplete="tel" />
  </label>
  <label>
    Project address
    <input name="streetAddress" autocomplete="street-address" />
  </label>
  <textarea name="message" placeholder="Project notes"></textarea>
  <input name="company" tabindex="-1" autocomplete="off" hidden />
  <button type="submit">Request estimate</button>
</form>

<script>
document.getElementById("crewmodo-lead-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const response = await fetch("${endpoint}", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID()
    },
    body: JSON.stringify({
      ...data,
      source: "Website form",
      sourceType: "website"
    })
  });
  if (!response.ok) throw new Error("Lead submission failed");
  form.reset();
});
</script>`, [endpoint]);

  const llmReference = useMemo(() => `# Crewmodo Lead Intake API

Create a lead in Crewmodo from a contractor website, landing page, automation tool, or server-side integration.

## Request

\`\`\`http
POST ${endpoint}
Content-Type: application/json
Idempotency-Key: website-{{unique_submission_id}}${settings?.requireSecret ? '\nx-crewmodo-lead-secret: {{lead_secret}}' : ''}
\`\`\`

\`\`\`json
{
  "name": "Jane Homeowner",
  "email": "jane@example.com",
  "phone": "(555) 010-0199",
  "streetAddress": "120 Oak Street",
  "city": "Bremerton",
  "state": "WA",
  "postalCode": "98310",
  "source": "Website form",
  "sourceType": "website",
  "message": "Looking for an exterior repaint estimate."
}
\`\`\`

### curl

\`\`\`curl
${curlExample}
\`\`\`

### JavaScript fetch

\`\`\`js
${fetchExample}
\`\`\`

## Parameters

${markdownTable(['Field', 'Type', 'Requirement', 'Description'], requestFields)}

## Responses

${markdownTable(['Status', 'Meaning', 'Details'], responseRows)}

## Authentication and Safety

- Public browser forms should use the allowed domains setting. Do not expose the server secret in public JavaScript.
- Server-to-server integrations can enable the server secret and send it as x-crewmodo-lead-secret.
- Send a stable Idempotency-Key for retries so duplicate webhook attempts do not create duplicate leads.
- Crewmodo rate limits each IP and organization to five submissions per minute.
- Include a hidden company field as a honeypot. Real users should leave it blank.
- A successful duplicate match returns HTTP 202 with duplicate: true instead of creating a second lead.

## Integration Checklist

- Enable lead intake in Crewmodo Settings.
- Copy the organization-specific endpoint from Settings.
- Set a default source label such as Website form.
- Add allowed domains for public forms.
- Enable the server secret only for private backend or automation integrations.
- Send a test lead and confirm it appears in Leads with source, activity, audit log, and notification history.
`, [curlExample, endpoint, fetchExample, settings?.requireSecret]);

  async function copyForLlm() {
    await navigator.clipboard.writeText(llmReference);
    window.showToast?.('Lead intake API reference copied for LLM', 'success');
  }

  return (
    <div className="mx-auto max-w-6xl py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="pf-kicker">Developer docs</p>
          <h1 className="pf-page-title">Lead Intake API</h1>
          <p className="pf-page-copy mt-2 max-w-3xl">
            Use this endpoint to create Crewmodo leads from contractor websites, landing pages, Zapier, Make, or server-side integrations.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" leftIcon={<Icon name="file-text" className="h-4 w-4" />} onClick={copyForLlm}>
            Copy for LLM
          </Button>
          <Button as="a" href="/settings#lead-intake-settings" variant="secondary" leftIcon={<Icon name="settings" className="h-4 w-4" />}>
            Intake settings
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-[var(--md-sys-color-error)] bg-[var(--md-sys-color-error-container)] px-4 py-3 text-sm text-[var(--md-sys-color-on-error-container)]">
          {error}
        </div>
      )}

      <div className="grid gap-5">
        <Card>
          <CardHeader title="Endpoint" description="Each organization has a unique slug-based endpoint. The exact URL is available in Settings." />
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-[var(--pf-border)] bg-[var(--md-sys-color-surface-container)] p-4">
              <p className="pf-meta">POST</p>
              <p className="mt-1 break-all font-mono text-sm text-[var(--md-sys-color-on-surface)]">{isLoading ? 'Loading endpoint...' : endpoint}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--pf-border)] p-4">
                <p className="pf-meta">Status</p>
                <p className="pf-row-title mt-1">{settings?.enabled === false ? 'Disabled' : 'Ready'}</p>
              </div>
              <div className="rounded-lg border border-[var(--pf-border)] p-4">
                <p className="pf-meta">Security</p>
                <p className="pf-row-title mt-1">{settings?.requireSecret ? 'Secret required' : 'Domain or public form'}</p>
              </div>
              <div className="rounded-lg border border-[var(--pf-border)] p-4">
                <p className="pf-meta">Default source</p>
                <p className="pf-row-title mt-1">{settings?.defaultSource || 'Website form'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Authentication and Safety" description="Public website forms should use an allowed domain. Server integrations can also require a secret header." />
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--pf-border)] p-4">
              <p className="pf-row-title">Browser forms</p>
              <p className="pf-copy mt-1">Keep the server secret off public pages. Add the website domain in Settings so Crewmodo can reject submissions from unknown origins.</p>
            </div>
            <div className="rounded-lg border border-[var(--pf-border)] p-4">
              <p className="pf-row-title">Server-to-server</p>
              <p className="pf-copy mt-1">Enable the server secret and send it as <code className="rounded bg-gray-100 px-1 py-0.5">x-crewmodo-lead-secret</code>. Rotate it if a vendor changes.</p>
            </div>
            <div className="rounded-lg border border-[var(--pf-border)] p-4">
              <p className="pf-row-title">Idempotency</p>
              <p className="pf-copy mt-1">Send a stable <code className="rounded bg-gray-100 px-1 py-0.5">Idempotency-Key</code> for retries so refreshes or webhook retries do not create duplicate leads.</p>
            </div>
            <div className="rounded-lg border border-[var(--pf-border)] p-4">
              <p className="pf-row-title">Spam protection</p>
              <p className="pf-copy mt-1">Crewmodo rate limits each IP and organization to five submissions per minute and supports a hidden <code className="rounded bg-gray-100 px-1 py-0.5">company</code> honeypot field.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Request Body" description="Send JSON. Name is required, plus either phone or email." />
          <CardContent>
            <DocsTable columns={['Field', 'Type', 'Requirement', 'Description']} rows={requestFields} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Responses" description="Success returns the lead ID. Duplicate submissions are accepted and marked as duplicate." />
          <CardContent>
            <DocsTable columns={['Status', 'Meaning', 'Details']} rows={responseRows} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Examples" description="Use curl for server tests, fetch for custom code, or the HTML snippet for simple website forms." />
          <CardContent className="space-y-4">
            <CodeBlock label="curl" code={curlExample} />
            <CodeBlock label="JavaScript fetch" code={fetchExample} />
            <CodeBlock label="HTML form" code={formExample} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Integration Checklist" description="Use this as the handoff checklist for a contractor website developer or automation consultant." />
          <CardContent>
            <ul className="grid gap-3 text-sm text-[var(--md-sys-color-on-surface-variant)]">
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-[var(--pf-success)]" />Enable lead intake in Settings.</li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-[var(--pf-success)]" />Set the default source label used for new leads.</li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-[var(--pf-success)]" />Add allowed domains for public website forms.</li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-[var(--pf-success)]" />Use the server secret only from private backends or automation tools.</li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-[var(--pf-success)]" />Send a test lead and confirm it appears in Leads with source, activity, and notification history.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
