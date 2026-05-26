import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { apiJson, formatMoney, labelize } from '@/lib/api';

interface TeamMember {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  hourlyRate?: string | number | null;
  burdenRate?: string | number | null;
  isActive?: boolean | null;
}

interface TimeClockSettings {
  roundingIncrementMinutes?: number | null;
  clockOutWarningHours?: number | string | null;
  maxShiftHours?: number | string | null;
}

interface MemberFormState {
  id: string;
  name: string;
  email: string;
  role: string;
  hourlyRate: string;
  burdenRate: string;
  isActive: boolean;
}

const emptyMemberForm: MemberFormState = {
  id: '',
  name: '',
  email: '',
  role: 'painter',
  hourlyRate: '',
  burdenRate: '30',
  isActive: true,
};

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  crew: 'Crew member',
  crew_lead: 'Crew lead',
  estimator: 'Estimator',
  painter: 'Painter',
  prep: 'Prep crew',
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function burdenedRate(member: Pick<TeamMember, 'hourlyRate' | 'burdenRate'>) {
  const base = numberValue(member.hourlyRate);
  const burden = numberValue(member.burdenRate);
  return base * (1 + burden / 100);
}

function isActiveMember(member: TeamMember) {
  return member.isActive !== false;
}

function memberRoleLabel(role?: string | null) {
  const key = String(role || '').toLowerCase();
  return roleLabels[key] || labelize(key || 'crew');
}

function StatCard({ label, value, help }: { label: string; value: string | number; help: string }) {
  return (
    <Card padding="sm">
      <p className="pf-meta">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-950">{value}</p>
      <p className="pf-helper mt-1">{help}</p>
    </Card>
  );
}

function TeamMemberRow({
  member,
  inactive = false,
  onEdit,
}: {
  member: TeamMember;
  inactive?: boolean;
  onEdit: (member: TeamMember) => void;
}) {
  return (
    <article className={`grid grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] ${inactive ? 'bg-gray-50 opacity-85' : ''}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="pf-row-title truncate">{member.name || 'Unnamed crew member'}</h3>
          <Badge size="sm">{memberRoleLabel(member.role)}</Badge>
          {inactive && <Badge variant="danger" size="sm">Deactivated</Badge>}
        </div>
        <p className="pf-copy mt-1 truncate">{member.email || 'No email on file'}</p>
      </div>
      <div className="grid grid-cols-3 items-center gap-2 sm:gap-3 lg:grid-cols-[7.5rem_7.5rem_8.75rem_auto]">
        <div>
          <p className="pf-meta">Base pay</p>
          <p className="pf-emphasis">{formatMoney(member.hourlyRate)}/hr</p>
        </div>
        <div>
          <p className="pf-meta">Burden</p>
          <p className="pf-emphasis">{numberValue(member.burdenRate).toFixed(1)}%</p>
        </div>
        <div>
          <p className="pf-meta">Job cost</p>
          <p className="pf-emphasis">{formatMoney(burdenedRate(member))}/hr</p>
        </div>
        <div className="col-span-3 flex justify-end lg:col-span-1">
          <button type="button" className="btn-icon btn-icon-tonal" aria-label={`Edit ${member.name || 'crew member'}`} onClick={() => onEdit(member)}>
            <Icon name="edit" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [settings, setSettings] = useState<TimeClockSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [memberForm, setMemberForm] = useState<MemberFormState>(emptyMemberForm);
  const [policyForm, setPolicyForm] = useState({
    roundingIncrementMinutes: '15',
    clockOutWarningHours: '8',
    maxShiftHours: '12',
  });

  const activeMembers = useMemo(() => members.filter(isActiveMember), [members]);
  const inactiveMembers = useMemo(() => members.filter((member) => !isActiveMember(member)), [members]);
  const averageBurdenedRate = activeMembers.length
    ? activeMembers.reduce((sum, member) => sum + burdenedRate(member), 0) / activeMembers.length
    : 0;
  const previewRate = burdenedRate(memberForm);

  useEffect(() => {
    loadTeam();
  }, []);

  useEffect(() => {
    document.body.style.overflow = modalOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [modalOpen]);

  async function loadTeam() {
    setError('');
    setIsLoading(true);
    try {
      const [membersPayload, settingsPayload] = await Promise.all([
        apiJson<{ data?: TeamMember[] }>('/v1/settings/team'),
        apiJson<{ data?: TimeClockSettings }>('/v1/settings/time-clock'),
      ]);
      const nextSettings = settingsPayload.data || null;
      setMembers(membersPayload.data || []);
      setSettings(nextSettings);
      setPolicyForm({
        roundingIncrementMinutes: String(nextSettings?.roundingIncrementMinutes || 15),
        clockOutWarningHours: String(nextSettings?.clockOutWarningHours || 8),
        maxShiftHours: String(nextSettings?.maxShiftHours || 12),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setIsLoading(false);
    }
  }

  function openMemberModal(member?: TeamMember) {
    setMemberForm(member ? {
      id: member.id,
      name: member.name || '',
      email: member.email || '',
      role: member.role || 'painter',
      hourlyRate: member.hourlyRate == null ? '' : String(member.hourlyRate),
      burdenRate: member.burdenRate == null ? '30' : String(member.burdenRate),
      isActive: isActiveMember(member),
    } : emptyMemberForm);
    setModalOpen(true);
  }

  function closeMemberModal() {
    if (isSavingMember) return;
    setModalOpen(false);
  }

  async function saveMember(event: FormEvent) {
    event.preventDefault();
    const existingMember = memberForm.id ? members.find((member) => member.id === memberForm.id) : null;
    if (existingMember && isActiveMember(existingMember) && !memberForm.isActive) {
      const confirmed = window.confirm('Deactivate this crew member? They will be hidden from new timecards, but historical time stays on jobs.');
      if (!confirmed) return;
    }

    setIsSavingMember(true);
    try {
      const payload = {
        name: memberForm.name,
        email: memberForm.email,
        role: memberForm.role,
        hourlyRate: memberForm.hourlyRate,
        burdenRate: memberForm.burdenRate,
        isActive: memberForm.isActive,
      };
      await apiJson(memberForm.id ? `/v1/settings/team/${memberForm.id}` : '/v1/settings/team', {
        method: memberForm.id ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(memberForm.id ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        },
        body: JSON.stringify(payload),
      });
      window.showToast?.(memberForm.id ? 'Team member updated' : 'Team member added', 'success');
      setModalOpen(false);
      await loadTeam();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save team member', 'error');
    } finally {
      setIsSavingMember(false);
    }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setIsSavingPolicy(true);
    try {
      await apiJson('/v1/settings/time-clock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundingIncrementMinutes: Number(policyForm.roundingIncrementMinutes),
          clockOutWarningHours: Number(policyForm.clockOutWarningHours),
          maxShiftHours: Number(policyForm.maxShiftHours),
        }),
      });
      window.showToast?.('Time clock policy saved', 'success');
      await loadTeam();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save time clock policy', 'error');
    } finally {
      setIsSavingPolicy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="pf-copy max-w-2xl">
          Manage crew roles, pay rates, labor burden, and time clock policy. Job timecards use these settings automatically for job costing.
        </p>
        <Button type="button" onClick={() => openMemberModal()} leftIcon={<Icon name="plus" className="h-4 w-4" />} className="w-full sm:w-auto">
          Add crew member
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active crew" value={activeMembers.length} help="Available for scheduling and timecards" />
        <StatCard label="Crew leads" value={activeMembers.filter((member) => member.role === 'crew_lead').length} help="Can log daily crew time" />
        <StatCard label="Deactivated" value={inactiveMembers.length} help="Hidden from new time entries" />
        <StatCard label="Avg burdened rate" value={formatMoney(averageBurdenedRate)} help="Used for labor costing" />
      </div>

      {error && (
        <Card className="mb-5 border-red-100 bg-red-50" padding="sm">
          <p className="pf-copy text-red-700">{error}</p>
        </Card>
      )}

      <div className="grid gap-5">
        <Card padding="sm">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <h2 className="pf-section-title">Labor Rate Policy</h2>
              <p className="pf-copy mt-1">Base pay is the payroll rate. Labor burden covers payroll tax, workers comp, benefits, drive time, and overhead allocation.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="pf-meta">Typical burden</p>
                <p className="pf-emphasis">25-45%</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="pf-meta">Crew access</p>
                <p className="pf-emphasis">Hours only</p>
              </div>
            </div>
          </div>
        </Card>

        <Card padding="sm">
          <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" onSubmit={savePolicy}>
            <div>
              <h2 className="pf-section-title">Time Clock Policy</h2>
              <p className="pf-copy mt-1">Crew punch times are rounded for job costing while actual GPS punch events are kept for review.</p>
              {settings && (
                <p className="pf-meta mt-2">
                  Missed clock-out reminders run during the evening review window, 6pm-10pm Pacific.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_8rem_8rem_auto]">
              <label>
                <span className="form-label">Rounding</span>
                <select className="input" value={policyForm.roundingIncrementMinutes} onChange={(event) => setPolicyForm({ ...policyForm, roundingIncrementMinutes: event.target.value })}>
                  <option value="1">Exact</option>
                  <option value="5">5 min</option>
                  <option value="6">6 min</option>
                  <option value="15">15 min</option>
                </select>
              </label>
              <label>
                <span className="form-label">Warn after</span>
                <input className="input" type="number" min="1" max="24" step="0.5" inputMode="decimal" value={policyForm.clockOutWarningHours} onChange={(event) => setPolicyForm({ ...policyForm, clockOutWarningHours: event.target.value })} />
              </label>
              <label>
                <span className="form-label">Max shift</span>
                <input className="input" type="number" min="4" max="24" step="0.5" inputMode="decimal" value={policyForm.maxShiftHours} onChange={(event) => setPolicyForm({ ...policyForm, maxShiftHours: event.target.value })} />
              </label>
              <Button type="submit" variant="secondary" isLoading={isSavingPolicy} className="sm:self-end">
                Save policy
              </Button>
            </div>
          </form>
        </Card>

        <Card padding="none">
          <CardHeader
            className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
            title="Active Crew"
            description="Use clear roles so leads can create crew timecards without managing payroll settings."
          >
            <div className="mt-3">
              <Button as="a" href="/time" variant="secondary" size="sm">Review timesheets</Button>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-gray-200">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                <p className="pf-copy mt-3">Loading crew...</p>
              </div>
            ) : activeMembers.length ? (
              activeMembers.map((member) => <TeamMemberRow key={member.id} member={member} onEdit={openMemberModal} />)
            ) : (
              <div className="p-8 text-center">
                <p className="pf-emphasis">No active crew members yet.</p>
                <p className="pf-copy mt-1">Add crew members before logging job timecards.</p>
                <Button type="button" className="mt-4" onClick={() => openMemberModal()}>Add crew member</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader
            className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
            title="Deactivated Crew"
            description="Hidden from new timecards and time entry forms, but preserved for historical job costing."
          />
          <CardContent className="divide-y divide-gray-200">
            {isLoading ? (
              <div className="p-6 text-center text-gray-500">Loading...</div>
            ) : inactiveMembers.length ? (
              inactiveMembers.map((member) => <TeamMemberRow key={member.id} member={member} inactive onEdit={openMemberModal} />)
            ) : (
              <div className="p-6 text-center text-gray-500">No deactivated crew members.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {modalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-member-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMemberModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 id="team-member-modal-title" className="pf-section-title">{memberForm.id ? 'Edit Crew Member' : 'Add Crew Member'}</h3>
                <p className="pf-copy mt-1">Rates are visible to office users and applied automatically to labor costs.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close" onClick={closeMemberModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={saveMember}>
              <label className="block">
                <span className="form-label">Full name</span>
                <input className="input" required autoComplete="name" enterKeyHint="next" placeholder="Maria Sanchez" value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} />
              </label>
              <label className="block">
                <span className="form-label">Email</span>
                <input className="input" type="email" autoComplete="email" inputMode="email" enterKeyHint="next" placeholder="maria@example.com" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} />
                <span className="form-helper mt-1">Crew use this email on the login page. Their access is limited to clocking in, clocking out, and their own timecards.</span>
              </label>
              <label className="block">
                <span className="form-label">Role</span>
                <select className="input" value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}>
                  <option value="crew_lead">Crew lead</option>
                  <option value="painter">Painter</option>
                  <option value="prep">Prep crew</option>
                  <option value="estimator">Estimator</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="form-label">Base pay rate</span>
                  <input className="input" type="number" step="0.01" min="0" inputMode="decimal" autoComplete="off" placeholder="28.00" value={memberForm.hourlyRate} onChange={(event) => setMemberForm({ ...memberForm, hourlyRate: event.target.value })} />
                </label>
                <label className="block">
                  <span className="form-label">Labor burden %</span>
                  <input className="input" type="number" step="0.01" min="0" max="100" inputMode="decimal" autoComplete="off" placeholder="35" value={memberForm.burdenRate} onChange={(event) => setMemberForm({ ...memberForm, burdenRate: event.target.value })} />
                </label>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                Job cost rate: <span className="font-semibold text-gray-950">{formatMoney(previewRate)}/hr</span>. Crew leads log hours; owners manage this rate.
              </div>
              {memberForm.id && (
                <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <span>
                    <span className="block font-semibold text-gray-950">Active crew member</span>
                    <span className="form-helper mt-1">Active crew show in scheduling and time entry forms. Deactivated crew stay in historical job costs.</span>
                  </span>
                  <input className="h-5 w-5" type="checkbox" role="switch" checked={memberForm.isActive} onChange={(event) => setMemberForm({ ...memberForm, isActive: event.target.checked })} aria-label="Active crew member" />
                </label>
              )}
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeMemberModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isSavingMember}>Save member</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
