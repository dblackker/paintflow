import { FormEvent, useMemo, useState } from 'react';

import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { API_URL } from '@/lib/api';

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  next.setDate(next.getDate() - day);
  return next;
}

const today = new Date();

const ranges = [
  {
    label: 'This week',
    getRange: () => {
      const start = startOfWeek(today);
      return { start: toDateInput(start), end: toDateInput(addDays(start, 6)) };
    },
  },
  {
    label: 'Last 2 weeks',
    getRange: () => ({ start: toDateInput(addDays(today, -13)), end: toDateInput(today) }),
  },
  {
    label: 'This month',
    getRange: () => {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: toDateInput(start), end: toDateInput(end) };
    },
  },
];

export function Payroll() {
  const defaultRange = useMemo(() => ranges[1].getRange(), []);
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);
  const [error, setError] = useState('');

  function applyRange(range: (typeof ranges)[number]) {
    const next = range.getRange();
    setStart(next.start);
    setEnd(next.end);
    setError('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!start || !end) {
      setError('Choose a start and end date before exporting payroll.');
      return;
    }

    if (start > end) {
      setError('Start date must be before the end date.');
      return;
    }

    const params = new URLSearchParams({ start, end });
    window.location.href = `${API_URL}/v1/payroll/export?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-4xl px-1 pb-24 sm:px-0">
      <div className="mb-5">
        <p className="pf-copy">Export approved time entries for payroll systems.</p>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Export time entries"
            description="Choose a payroll period and download approved time entries as a CSV."
          />
          <CardContent>
            <div className="mb-5 flex flex-wrap gap-2" aria-label="Quick payroll date ranges">
              {ranges.map((range) => (
                <Button key={range.label} type="button" variant="secondary" size="sm" onClick={() => applyRange(range)}>
                  {range.label}
                </Button>
              ))}
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Start date"
                  type="date"
                  autoComplete="off"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  required
                />
                <Input
                  label="End date"
                  type="date"
                  autoComplete="off"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  required
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {error}
                </div>
              )}

              <Button type="submit" fullWidth leftIcon={<Icon name="file-text" className="h-4 w-4" />}>
                Download CSV
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-blue-50/70">
          <CardHeader title="Payroll file format" />
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="font-medium text-blue-950">Columns</dt>
              <dd className="text-blue-900">
                Employee, Date, Hours, Hourly Rate, Burden %, Burdened Rate, Total Pay, Description
              </dd>
              <dt className="font-medium text-blue-950">Best for</dt>
              <dd className="text-blue-900">QuickBooks Payroll, Gusto, ADP, or a payroll review spreadsheet.</dd>
            </dl>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card padding="sm">
            <div className="flex items-start gap-3">
              <span className="rounded-full bg-gray-100 p-2 text-gray-700">
                <Icon name="clock" className="h-4 w-4" />
              </span>
              <div>
                <p className="pf-body-strong">Review approvals first</p>
                <p className="pf-copy mt-1">Payroll export includes approved time entries for the selected period.</p>
                <Button as="a" href="/time" variant="ghost" size="sm" className="mt-2 -ml-3">
                  Open time tracking
                </Button>
              </div>
            </div>
          </Card>
          <Card padding="sm">
            <div className="flex items-start gap-3">
              <span className="rounded-full bg-gray-100 p-2 text-gray-700">
                <Icon name="users" className="h-4 w-4" />
              </span>
              <div>
                <p className="pf-body-strong">Keep crew rates current</p>
                <p className="pf-copy mt-1">Employee rate and burden values come from team member settings.</p>
                <Button as="a" href="/team" variant="ghost" size="sm" className="mt-2 -ml-3">
                  Open team
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
