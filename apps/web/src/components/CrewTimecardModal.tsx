import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal, ModalFooter } from '@/components/Modal';
import { formatMoney, labelize } from '@/lib/api';

export interface CrewTimecardMember {
  id: string;
  name: string;
  role?: string | null;
  hourlyRate?: string | number | null;
  isActive?: boolean | null;
}

export interface CrewTimecardJob {
  id: string;
  name?: string | null;
  leadName?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
}

export interface CrewTimecardEntry {
  teamMemberId: string;
  hours: number;
  description?: string;
}

export interface CrewTimecardPayload {
  jobId: string;
  date: string;
  notes?: string;
  entries: CrewTimecardEntry[];
}

interface CrewTimecardModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: CrewTimecardMember[];
  jobs?: CrewTimecardJob[];
  jobId?: string;
  title?: string;
  description?: string;
  isSaving?: boolean;
  onSubmit: (payload: CrewTimecardPayload) => Promise<void>;
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  crew: 'Crew member',
  crew_lead: 'Crew lead',
  estimator: 'Estimator',
  painter: 'Painter',
  prep: 'Prep crew',
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function jobLabel(job?: CrewTimecardJob) {
  if (!job) return 'Selected job';
  const address = [
    job.leadStreetAddress,
    [job.leadCity, job.leadState].filter(Boolean).join(', '),
  ].filter(Boolean).join(' ');
  const name = job.name || job.leadName || 'Job';
  return address ? `${address} - ${name}` : name;
}

export function CrewTimecardModal({
  isOpen,
  onClose,
  members,
  jobs = [],
  jobId,
  title = 'Crew Timecard',
  description = 'Fast end-of-day crew entry. Hours are submitted against the selected job.',
  isSaving = false,
  onSubmit,
}: CrewTimecardModalProps) {
  const activeMembers = useMemo(
    () => members.filter((member) => member.isActive !== false),
    [members],
  );
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [memberHours, setMemberHours] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setDate(todayInput());
    setNotes('');
    setSelectedMembers(new Set(activeMembers.map((member) => member.id)));
    setMemberHours(Object.fromEntries(activeMembers.map((member) => [member.id, '8'])));
  }, [activeMembers, isOpen]);

  const selected = useMemo(
    () => activeMembers.filter((member) => selectedMembers.has(member.id)),
    [activeMembers, selectedMembers],
  );
  const averageHours = selected.length
    ? selected.reduce((sum, member) => sum + numberValue(memberHours[member.id]), 0) / selected.length
    : 0;
  const selectedJob = jobs.find((job) => job.id === jobId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobId) {
      window.showToast?.('Choose a job before logging time.', 'error');
      return;
    }
    const entries = selected
      .map((member) => ({
        teamMemberId: member.id,
        hours: Number(memberHours[member.id] || 0),
        description: notes.trim() || undefined,
      }))
      .filter((entry) => entry.hours > 0);

    if (!entries.length) {
      window.showToast?.('Select at least one crew member with hours.', 'error');
      return;
    }

    await onSubmit({
      jobId,
      date: new Date(`${date}T12:00:00`).toISOString(),
      notes: notes.trim() || undefined,
      entries,
    });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="pf-copy">{description}</p>

        <div className="rounded-lg border bg-gray-50 p-3">
          <span className="form-label">Job</span>
          <p className="mt-1 truncate text-sm font-medium text-gray-950">{jobLabel(selectedJob)}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="form-label">Date</span>
            <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            <span className="form-label">Notes</span>
            <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Crew labor" autoComplete="off" />
          </label>
        </div>

        <div className="rounded-lg border bg-blue-50 p-3 text-sm font-medium text-blue-900">
          {selected.length} selected - average {averageHours.toFixed(2)} hrs
        </div>

        {activeMembers.length === 0 ? (
          <div className="rounded-lg border p-4 text-sm text-gray-600">
            Add active crew members on the <Link to="/team" className="font-medium text-blue-700">Team page</Link> before logging job timecards.
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {activeMembers.map((member) => (
              <label key={member.id} className="grid grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-3 rounded-lg border p-3">
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(member.id)}
                    onChange={(event) => {
                      setSelectedMembers((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(member.id);
                        else next.delete(member.id);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-950">{member.name}</span>
                    <span className="block text-xs text-gray-500">
                      {roleLabels[String(member.role || '')] || labelize(member.role)} {member.hourlyRate ? `- ${formatMoney(member.hourlyRate)}/hr` : ''}
                    </span>
                  </span>
                </span>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.25"
                  inputMode="decimal"
                  className="input text-right"
                  aria-label={`Hours for ${member.name}`}
                  value={memberHours[member.id] || ''}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setMemberHours((current) => ({ ...current, [member.id]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        )}

        <ModalFooter className="-mx-6 -mb-4 mt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={isSaving || activeMembers.length === 0}>
            {isSaving ? 'Submitting...' : 'Submit timecard'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
