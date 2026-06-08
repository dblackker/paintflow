import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

type GroupFilter = 'all' | 'sales' | 'handoff' | 'production' | 'closeout';

interface PipelineStage {
  id: string;
  label: string;
  group: Exclude<GroupFilter, 'all'>;
}

interface PipelineCard {
  id: string;
  leadId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  };
  source?: string | null;
  stage: string;
  daysInStage: number;
  value: number;
  href: string;
  nextActivity?: {
    id: string;
    type: string;
    title: string;
    dueAt?: string | null;
  } | null;
  warnings: string[];
}

interface PipelineData {
  stages: PipelineStage[];
  cards: PipelineCard[];
  summary: {
    totalValue?: number;
    activeCustomers?: number;
    openActivities?: number;
    staleCount?: number;
  };
}

interface ActivityModalState {
  leadId: string;
  name: string;
}

interface TransitionModalState {
  leadId: string;
  name: string;
  currentStage: string;
  targetStage: string;
}

const groupFilters: Array<{ value: GroupFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'sales', label: 'Sales' },
  { value: 'handoff', label: 'Handoff' },
  { value: 'production', label: 'Production' },
  { value: 'closeout', label: 'Closeout' },
];

const activityTypes = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'call', label: 'Call' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'site_visit', label: 'Site visit' },
  { value: 'task', label: 'Task' },
  { value: 'note', label: 'Note' },
];

function compactDate(value?: string | null) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function dateTimeLocalValue(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function cardAddress(card: PipelineCard) {
  return formatAddress({
    streetAddress: card.address?.street,
    city: card.address?.city,
    state: card.address?.state,
    postalCode: card.address?.postalCode,
  });
}

function transitionHelper(targetStage: string) {
  if (targetStage === 'lost') return 'Archive lost work with a short reason so win/loss reports and future follow-ups stay useful.';
  if (targetStage === 'estimate_sent') return 'This stage is normally set automatically when an estimate is sent.';
  if (['scheduled', 'in_production', 'punch_list', 'completed_review'].includes(targetStage)) return 'Production stages are normally driven by the job status once a job exists.';
  if (['won_deposit_pending', 'ready_to_schedule'].includes(targetStage)) return 'This is normally set after a customer signs an estimate, but you can move it manually for offline commitments.';
  return 'Use this when the customer interaction happened outside Crewmodo.';
}

function stageAgeTone(daysInStage: number) {
  if (daysInStage >= 14) {
    return {
      label: 'Stale',
      className: 'border-red-200 bg-red-50 text-red-800',
    };
  }
  if (daysInStage >= 7) {
    return {
      label: 'Aging',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }
  if (daysInStage >= 3) {
    return {
      label: 'Monitor',
      className: 'border-blue-200 bg-blue-50 text-blue-800',
    };
  }
  return {
    label: 'Fresh',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
}

export function Pipeline() {
  const [data, setData] = useState<PipelineData>({ stages: [], cards: [], summary: {} });
  const [activeGroup, setActiveGroup] = useState<GroupFilter>('sales');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragPayload, setDragPayload] = useState<{ leadId: string; currentStage: string; name: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [activityModal, setActivityModal] = useState<ActivityModalState | null>(null);
  const [transitionModal, setTransitionModal] = useState<TransitionModalState | null>(null);
  const [activityForm, setActivityForm] = useState({ type: 'follow_up', dueAt: '', title: 'Follow up with customer', notes: '' });
  const [transitionForm, setTransitionForm] = useState({ reason: '', activityTitle: '', dueAt: '' });
  const [isSavingActivity, setIsSavingActivity] = useState(false);
  const [isSavingTransition, setIsSavingTransition] = useState(false);

  async function loadPipeline() {
    setIsLoading(true);
    try {
      const response = await apiJson<{ data: PipelineData }>('/v1/pipeline');
      setData(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadPipeline();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', Boolean(activityModal || transitionModal));
    return () => document.body.classList.remove('pf-modal-open');
  }, [activityModal, transitionModal]);

  const visibleStages = useMemo(() => data.stages.filter((stage) => activeGroup === 'all' || stage.group === activeGroup), [activeGroup, data.stages]);

  function cardsForStage(stageId: string) {
    return data.cards
      .filter((card) => card.stage === stageId && (!attentionOnly || card.warnings.length))
      .sort((a, b) => {
        const warningDelta = Number(Boolean(b.warnings.length)) - Number(Boolean(a.warnings.length));
        if (warningDelta) return warningDelta;
        const aDue = a.nextActivity?.dueAt ? new Date(a.nextActivity.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.nextActivity?.dueAt ? new Date(b.nextActivity.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return Number(b.daysInStage || 0) - Number(a.daysInStage || 0);
      });
  }

  function stageLabel(stageId: string) {
    return data.stages.find((stage) => stage.id === stageId)?.label || labelize(stageId);
  }

  function openActivity(card: PipelineCard) {
    setActivityForm({ type: 'follow_up', dueAt: '', title: 'Follow up with customer', notes: '' });
    setActivityModal({ leadId: card.leadId, name: card.name });
  }

  function openTransition(card: PipelineCard, targetStage = card.stage) {
    setTransitionForm({ reason: '', activityTitle: '', dueAt: '' });
    setTransitionModal({
      leadId: card.leadId,
      name: card.name,
      currentStage: card.stage,
      targetStage,
    });
  }

  function transitionFromDrag(targetStage: string) {
    if (!dragPayload || dragPayload.currentStage === targetStage) return;
    const card = data.cards.find((item) => item.leadId === dragPayload.leadId);
    setDragPayload(null);
    setDropTarget(null);
    setTransitionForm({ reason: '', activityTitle: '', dueAt: '' });
    setTransitionModal({
      leadId: dragPayload.leadId,
      name: dragPayload.name || card?.name || 'Customer',
      currentStage: dragPayload.currentStage || card?.stage || '',
      targetStage,
    });
  }

  async function submitActivity(event: FormEvent) {
    event.preventDefault();
    if (!activityModal || isSavingActivity || !activityForm.title.trim()) return;
    setIsSavingActivity(true);
    try {
      await apiJson('/v1/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          leadId: activityModal.leadId,
          type: activityForm.type,
          title: activityForm.title.trim(),
          notes: activityForm.notes.trim() || null,
          dueAt: activityForm.dueAt ? new Date(activityForm.dueAt).toISOString() : null,
        }),
      });
      window.showToast?.('Activity saved', 'success');
      setActivityModal(null);
      await loadPipeline();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save activity', 'error');
    } finally {
      setIsSavingActivity(false);
    }
  }

  async function submitTransition(event: FormEvent) {
    event.preventDefault();
    if (!transitionModal || isSavingTransition) return;
    setIsSavingTransition(true);
    try {
      const response = await apiJson<{ data?: { unchanged?: boolean } }>(`/v1/pipeline/cards/${transitionModal.leadId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          targetStage: transitionModal.targetStage,
          reason: transitionForm.reason || null,
          activityTitle: transitionForm.activityTitle || null,
          dueAt: transitionForm.dueAt ? new Date(transitionForm.dueAt).toISOString() : null,
        }),
      });
      window.showToast?.(response.data?.unchanged ? 'No pipeline change needed' : 'Customer moved', 'success');
      setTransitionModal(null);
      await loadPipeline();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to move customer', 'error');
    } finally {
      setIsSavingTransition(false);
    }
  }

  return (
    <div className="mx-auto max-w-[92rem] px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="pf-kicker">Customer workflow</p>
          <p className="pf-page-copy mt-1 max-w-3xl">Track customers from lead capture through estimate, scheduling, production, and closeout.</p>
        </div>
        <div className="mobile-action-row flex flex-wrap gap-2">
          <Link className="btn-secondary btn-sm" to="/leads?new=1">Add lead</Link>
          <Link className="btn-primary btn-sm" to="/estimates/production">Create estimate</Link>
        </div>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Pipeline value" value={formatMoney(data.summary.totalValue || 0)} />
        <Metric label="Active customers" value={data.summary.activeCustomers || 0} />
        <Metric label="Open activities" value={data.summary.openActivities || 0} />
        <Metric label="Needs attention" value={data.summary.staleCount || 0} />
      </section>

      <section className="mobile-filter-panel mt-5 rounded-lg border bg-white p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="pf-scroll-tabs flex gap-2 overflow-x-auto pb-1">
            {groupFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`min-h-11 shrink-0 rounded-full border px-3.5 py-2 text-sm font-semibold ${activeGroup === filter.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600'}`}
                onClick={() => setActiveGroup(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="rounded border-gray-300" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} />
            Needs attention only
          </label>
        </div>
      </section>

      <section className="mt-5">
        {error ? (
          <Card className="border-red-200 bg-red-50 text-center text-red-700">{error}</Card>
        ) : isLoading ? (
          <Card className="p-8 text-center text-gray-500">Loading pipeline...</Card>
        ) : visibleStages.length === 0 ? (
          <Card className="p-8 text-center text-gray-500">No stages available.</Card>
        ) : (
          <div className={`${activeGroup === 'all' ? 'grid grid-cols-1 md:auto-cols-[minmax(16rem,18rem)] md:grid-flow-col md:overflow-x-auto' : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5'} gap-4 pb-2`}>
            {visibleStages.map((stage) => {
              const cards = cardsForStage(stage.id);
              const value = cards.reduce((sum, card) => sum + Number(card.value || 0), 0);
              const isDropTarget = dropTarget === stage.id;
              return (
                <section
                  key={stage.id}
                  className={`flex min-h-72 flex-col rounded-lg border p-3 transition ${isDropTarget ? 'border-blue-600 bg-blue-100 shadow-md' : dragPayload ? 'border-dashed border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}
                  onDragOver={(event) => {
                    if (!dragPayload) return;
                    event.preventDefault();
                    setDropTarget(stage.id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    transitionFromDrag(stage.id);
                  }}
                >
                  <div className="mb-3 flex items-start justify-between gap-2 rounded-md bg-gray-50/95 pb-2">
                    <div>
                      <h3 className="pf-row-title">{stage.label}</h3>
                      <p className="pf-meta">{cards.length} customers</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700">{formatMoney(value)}</span>
                  </div>
                  <div className="space-y-3">
                    {cards.length ? cards.map((card) => (
                      <PipelineCardView
                        key={card.id}
                        card={card}
                        onMove={() => openTransition(card)}
                        onActivity={() => openActivity(card)}
                        onDragStart={() => setDragPayload({ leadId: card.leadId, currentStage: card.stage, name: card.name })}
                        onDragEnd={() => {
                          setDragPayload(null);
                          setDropTarget(null);
                        }}
                      />
                    )) : <div className="rounded-lg border border-dashed bg-white p-4 text-sm text-gray-500">Drop a customer here or use Move.</div>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>

      {dragPayload && (
        <section className="fixed inset-x-4 bottom-4 z-40 grid grid-cols-2 gap-2 rounded-2xl border bg-white/95 p-2 shadow-xl sm:grid-cols-4">
          {visibleStages.filter((stage) => stage.id !== dragPayload.currentStage).map((stage) => (
            <button
              key={stage.id}
              type="button"
              className={`rounded-full border border-dashed px-3 py-2 text-xs font-bold ${dropTarget === stage.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-300 text-blue-700'}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget(stage.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                transitionFromDrag(stage.id);
              }}
              onClick={() => transitionFromDrag(stage.id)}
            >
              {stage.label}
            </button>
          ))}
        </section>
      )}

      {activityModal && (
        <Modal title="Add activity" subtitle={activityModal.name} onClose={() => setActivityModal(null)}>
          <form className="space-y-4" onSubmit={submitActivity}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Type" value={activityForm.type} onChange={(event) => setActivityForm({ ...activityForm, type: event.target.value })} options={activityTypes} />
              <Input label="Due" type="datetime-local" value={activityForm.dueAt} onChange={(event) => setActivityForm({ ...activityForm, dueAt: event.target.value })} />
            </div>
            <Input label="Title" required maxLength={255} autoComplete="off" placeholder="Call after estimate review" value={activityForm.title} onChange={(event) => setActivityForm({ ...activityForm, title: event.target.value })} />
            <Textarea label="Notes" rows={3} maxLength={5000} placeholder="Optional internal context" value={activityForm.notes} onChange={(event) => setActivityForm({ ...activityForm, notes: event.target.value })} />
            <div className="mobile-sticky-actions flex justify-end gap-2 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
              <Button type="button" variant="secondary" size="sm" onClick={() => setActivityModal(null)}>Cancel</Button>
              <Button type="submit" size="sm" isLoading={isSavingActivity} disabled={!activityForm.title.trim()}>Save activity</Button>
            </div>
          </form>
        </Modal>
      )}

      {transitionModal && (
        <Modal title="Move customer" subtitle={`${transitionModal.name} - ${stageLabel(transitionModal.currentStage)} to ${stageLabel(transitionModal.targetStage)}`} onClose={() => setTransitionModal(null)}>
          <form className="space-y-4" onSubmit={submitTransition}>
            <Select
              label="Pipeline stage"
              value={transitionModal.targetStage}
              onChange={(event) => setTransitionModal({ ...transitionModal, targetStage: event.target.value })}
              options={data.stages.map((stage) => ({ value: stage.id, label: stage.label }))}
            />
            <Textarea
              label="Reason or note"
              rows={3}
              maxLength={1000}
              placeholder="Optional context for this move"
              value={transitionForm.reason}
              onChange={(event) => setTransitionForm({ ...transitionForm, reason: event.target.value })}
              helperText="Required for lost work or manually won jobs without a signed estimate."
            />
            <div className="rounded-lg border bg-gray-50 p-3">
              <p className="pf-row-title">Optional follow-up</p>
              <p className="pf-meta mt-1">Create the next task while moving the customer.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Task" maxLength={255} autoComplete="off" placeholder="Call customer Friday" value={transitionForm.activityTitle} onChange={(event) => setTransitionForm({ ...transitionForm, activityTitle: event.target.value })} />
                <Input label="Due" type="datetime-local" value={transitionForm.dueAt} onChange={(event) => setTransitionForm({ ...transitionForm, dueAt: event.target.value })} />
              </div>
            </div>
            <div className="rounded-md bg-blue-50 px-3 py-2">
              <p className="pf-copy text-blue-900">{transitionHelper(transitionModal.targetStage)}</p>
            </div>
            <div className="mobile-sticky-actions flex justify-end gap-2 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
              <Button type="button" variant="secondary" size="sm" onClick={() => setTransitionModal(null)}>Cancel</Button>
              <Button type="submit" size="sm" isLoading={isSavingTransition}>Move customer</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="pf-metric-label">{label}</p>
      <p className="pf-metric-value mt-1">{value}</p>
    </div>
  );
}

function PipelineCardView({ card, onMove, onActivity, onDragStart, onDragEnd }: {
  card: PipelineCard;
  onMove: () => void;
  onActivity: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const address = cardAddress(card);
  const stageAge = stageAgeTone(Number(card.daysInStage || 0));
  return (
    <article
      className="mobile-card-row rounded-lg border bg-white p-3 shadow-sm"
      draggable
      onDragStart={(event) => {
        onDragStart();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify({ leadId: card.leadId, currentStage: card.stage, name: card.name }));
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link className="pf-row-title block truncate hover:text-blue-700" to={card.href}>{card.name}</Link>
          {address ? <p className="pf-meta mt-1 truncate">{address}</p> : <p className="pf-meta mt-1 truncate">{card.source || 'No address'}</p>}
        </div>
        <p className="pf-row-title shrink-0">{formatMoney(card.value)}</p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex gap-1.5">
          {card.phone && <a href={`tel:${card.phone}`} className="btn-icon btn-icon-outlined" aria-label={`Call ${card.name}`} title="Call"><Icon name="phone" className="pf-icon" /></a>}
          {card.email && <a href={`mailto:${card.email}`} className="btn-icon btn-icon-outlined" aria-label={`Email ${card.name}`} title="Email"><Icon name="mail" className="pf-icon" /></a>}
          <Link to={`/sms?leadId=${card.leadId}`} className="btn-icon btn-icon-outlined" aria-label={`Text ${card.name}`} title="Text"><Icon name="message" className="pf-icon" /></Link>
        </div>
      </div>
      <div className={`mt-3 flex flex-wrap items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold ${stageAge.className}`}>
        <span>{stageAge.label}</span>
        <span aria-hidden="true">·</span>
        <span>{card.daysInStage}d in stage</span>
      </div>
      {card.nextActivity && (
        <div className="mt-3 rounded-md bg-blue-50 px-2.5 py-2">
          <p className="pf-row-title text-blue-950">{labelize(card.nextActivity.type)}: {card.nextActivity.title}</p>
          <p className="pf-meta text-blue-900">{compactDate(card.nextActivity.dueAt)}</p>
        </div>
      )}
      {card.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {card.warnings.map((warning) => <p key={warning} className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{warning}</p>)}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <Link className="btn-text btn-sm min-h-11 px-3 py-2 text-blue-700" to={`/leads/${card.leadId}`}>Profile</Link>
        <div className="flex gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={onMove}>Move</Button>
          <Button type="button" variant="secondary" size="sm" onClick={onActivity}>Activity</Button>
        </div>
      </div>
    </article>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mobile-sheet fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-0 sm:items-start sm:p-6 sm:pt-24" role="dialog" aria-modal="true" aria-labelledby="pipeline-modal-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="max-h-[calc(100dvh-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[calc(100vh-6rem)] sm:rounded-lg sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="pipeline-modal-title" className="pf-section-title">{title}</h3>
            {subtitle && <p className="pf-copy">{subtitle}</p>}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}
