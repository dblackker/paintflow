import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { apiJson, formatAddress, formatMoney, labelize } from '@/lib/api';

type ViewMode = 'day' | 'job' | 'employee';
type ReviewStatus = 'approved' | 'rejected';

interface TeamMember {
  id: string;
  name: string;
  role?: string | null;
  hourlyRate?: string | number | null;
  burdenRate?: string | number | null;
  isActive?: boolean | null;
}

interface Job {
  id: string;
  jobNumber?: string | null;
  name?: string | null;
  leadName?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  scheduledStartAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

interface TimeClockSettings {
  roundingIncrementMinutes?: number;
  clockOutWarningHours?: number;
  maxShiftHours?: number;
}

interface PunchSession {
  id: string;
  jobId?: string | null;
  jobName?: string | null;
  teamMemberId: string;
  teamMemberName?: string | null;
  status?: string | null;
  startedAtActual: string;
  endedAtActual?: string | null;
  startLatitude?: string | number | null;
  startLongitude?: string | number | null;
  endLatitude?: string | number | null;
  endLongitude?: string | number | null;
  reviewRequired?: boolean | null;
  reviewReason?: string | null;
  reviewLabel?: string | null;
}

interface PunchStatus {
  settings?: TimeClockSettings;
  canManage?: boolean;
  member?: TeamMember | null;
  members?: TeamMember[];
  jobs?: Job[];
  activeSession?: PunchSession | null;
  reviewQueue?: PunchSession[];
  memberResolutionError?: string | null;
}

interface TimeEntry {
  id: string;
  jobId?: string | null;
  jobName?: string | null;
  teamMemberId: string;
  teamMemberName?: string | null;
  hours: string | number;
  date: string;
  description?: string | null;
  hourlyRate?: string | number | null;
  totalCost?: string | number | null;
  source?: string | null;
  reviewStatus?: string | null;
  reviewReason?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  roundedStartAt?: string | null;
  roundedEndAt?: string | null;
  startLatitude?: string | number | null;
  startLongitude?: string | number | null;
  endLatitude?: string | number | null;
  endLongitude?: string | number | null;
  createdAt?: string | null;
}

interface MapEvent {
  id: string;
  type: string;
  occurredAt: string;
  latitude: number;
  longitude: number;
  teamMemberName?: string | null;
  jobName?: string | null;
  reviewRequired?: boolean | null;
  reviewReason?: string | null;
  address?: Parameters<typeof formatAddress>[0] | null;
}

interface MapPayload {
  events: MapEvent[];
  summary?: {
    clockIns?: number;
    clockOuts?: number;
    employees?: number;
    jobs?: number;
  };
}

interface MapViewport {
  centerLat: number;
  centerLng: number;
  zoom: number;
}

interface MapDragState {
  pointerId: number;
  startX: number;
  startY: number;
  centerPixelX: number;
  centerPixelY: number;
  zoom: number;
}

interface EditEntryState {
  id?: string;
  teamMemberId: string;
  jobId: string;
  date: string;
  hours: string;
  description: string;
}

interface TimeColumn {
  key: 'date' | 'job' | 'employee' | 'hours' | 'cost' | 'actions';
  label: string;
  align?: 'right';
}

interface BulkState {
  date: string;
  jobId: string;
  notes: string;
  defaultHours: string;
  roleFilters: Set<string>;
  selected: Set<string>;
  hours: Record<string, string>;
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  crew: 'Crew member',
  crew_lead: 'Crew lead',
  estimator: 'Estimator',
  painter: 'Painter',
  prep: 'Prep crew',
};

const reviewLabels: Record<string, string> = {
  forgot_clock_in: 'Forgot clock-in',
  late_clock_out: 'Late clock-out',
  long_shift: 'Long shift',
  missing_job_assignment: 'Missing job assignment',
};

const defaultRoles = new Set(['crew_lead', 'painter', 'prep']);
const viewStorageKey = 'paintflow.time.viewMode';
const mapStorageKey = 'paintflow.time.mapCollapsed';

function idempotencyKey() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function postHeaders() {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey(),
  };
}

function patchHeaders() {
  return { 'Content-Type': 'application/json' };
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekStart(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = next.getDate() - day + (day === 0 ? -6 : 1);
  next.setHours(0, 0, 0, 0);
  next.setDate(diff);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInput(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return todayInput();
  return date.toISOString().slice(0, 10);
}

function toDateTimeLocal(value: string | Date = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localIsoFromDateInput(value: string) {
  return new Date(`${value}T12:00:00`).toISOString();
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function formatHours(value: unknown) {
  return numberValue(value).toFixed(2).replace(/\.00$/, '');
}

function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return 'Missing';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Missing';
  return new Intl.DateTimeFormat('en-US', options || { month: 'short', day: 'numeric' }).format(date);
}

function formatDateTime(value?: string | null) {
  return formatDate(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatTime(value?: string | null) {
  return formatDate(value, { hour: 'numeric', minute: '2-digit' });
}

function dateKey(value: string) {
  return toDateInput(value);
}

function jobAddress(job: Partial<Job>) {
  return formatAddress({
    streetAddress: job.streetAddress,
    city: job.city,
    state: job.state,
    postalCode: job.postalCode,
    leadStreetAddress: job.leadStreetAddress,
    leadCity: job.leadCity,
    leadState: job.leadState,
    leadPostalCode: job.leadPostalCode,
  }).replace(/\s+\d{5}$/, '');
}

function jobLabel(job?: Job | null) {
  if (!job) return 'Unassigned job';
  const address = jobAddress(job);
  const customer = job.leadName ? ` - ${job.leadName}` : '';
  const name = [job.jobNumber, job.name || 'Job'].filter(Boolean).join(' - ');
  return address ? `${address}${customer} - ${name}` : `${name}${customer}`;
}

function timeSortValue(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function activePunchHours(session?: PunchSession | null) {
  if (!session?.startedAtActual) return 0;
  return Math.max(0, (Date.now() - new Date(session.startedAtActual).getTime()) / 36e5);
}

function reviewReasonText(value?: string | null) {
  return (value && reviewLabels[value]) || labelize(value) || 'Review required';
}

function mapHref(latitude?: string | number | null, longitude?: string | number | null) {
  if (!latitude || !longitude) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function latLngToWorldPixel(latitude: number, longitude: number, zoom: number) {
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  const scale = 256 * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldPixelToLatLng(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    latitude: Math.max(-85.0511, Math.min(85.0511, latitude)),
    longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
  };
}

function mapZoomForSpan(latSpan: number, lngSpan: number) {
  const span = Math.max(latSpan, lngSpan);
  if (span < 0.01) return 16;
  if (span < 0.03) return 15;
  if (span < 0.08) return 13;
  if (span < 0.2) return 11;
  if (span < 1) return 9;
  return 6;
}

function eventTypeLabel(type = '') {
  if (type.includes('clock_out')) return 'Clock out';
  if (type.includes('clock_in')) return 'Clock in';
  if (type.includes('reminder')) return 'Reminder';
  return labelize(type);
}

function groupTitleDate(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

async function requestLocation() {
  if (!navigator.geolocation) {
    throw new Error('Location is required, but this browser does not support geolocation.');
  }

  return new Promise<{ latitude: number; longitude: number; accuracyMeters?: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }),
      () => reject(new Error('Location permission is required to punch time.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

function warningIcon(content: string) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-amber-700 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300"
        aria-label={content}
      >
        <Icon name="warning" className="h-4 w-4" />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-7 z-20 hidden w-64 -translate-x-1/2 rounded-lg border border-amber-100 bg-white p-3 text-left text-xs font-normal leading-5 text-gray-700 shadow-lg group-hover:block group-focus-within:block">
        {content}
      </span>
    </span>
  );
}

function StatusMetric({ label, value, help }: { label: string; value: string | number; help: string }) {
  return (
    <Card padding="sm">
      <p className="pf-label-small uppercase tracking-wide text-gray-500">{label}</p>
      <p className="pf-value mt-1 text-gray-950">{value}</p>
      <p className="pf-helper mt-1">{help}</p>
    </Card>
  );
}

function MapLinkButton({
  latitude,
  longitude,
  label,
}: {
  latitude?: string | number | null;
  longitude?: string | number | null;
  label: string;
}) {
  const href = mapHref(latitude, longitude);
  if (!href) return null;
  return (
    <Button
      as="a"
      href={href}
      target="_blank"
      rel="noreferrer"
      variant="secondary"
      size="sm"
      leftIcon={<Icon name="map-pin" className="h-4 w-4" />}
      aria-label={`Open ${label} in maps`}
    >
      {label}
    </Button>
  );
}

export function Time() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(viewStorageKey);
    return saved === 'job' || saved === 'employee' || saved === 'day' ? saved : 'day';
  });
  const [mapCollapsed, setMapCollapsed] = useState(() => localStorage.getItem(mapStorageKey) !== 'false');
  const [mapDate, setMapDate] = useState(() => new Date());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [punchStatus, setPunchStatus] = useState<PunchStatus>({});
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [mapData, setMapData] = useState<MapPayload>({ events: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [error, setError] = useState('');
  const [punching, setPunching] = useState(false);
  const [selectedPunchMemberId, setSelectedPunchMemberId] = useState('');
  const [selectedPunchJobId, setSelectedPunchJobId] = useState('');
  const [showForgotClockOut, setShowForgotClockOut] = useState(false);
  const [forgotClockOutAt, setForgotClockOutAt] = useState(toDateTimeLocal());
  const [forgotClockOutNote, setForgotClockOutNote] = useState('');
  const [showForgotClockInModal, setShowForgotClockInModal] = useState(false);
  const [forgotClockInAt, setForgotClockInAt] = useState(toDateTimeLocal());
  const [forgotClockInNote, setForgotClockInNote] = useState('Forgot to clock in; entered later from the app.');
  const [showSwitchJobModal, setShowSwitchJobModal] = useState(false);
  const [switchJobId, setSwitchJobId] = useState('');
  const [showLongShiftModal, setShowLongShiftModal] = useState(false);
  const [confirmedLongClockOut, setConfirmedLongClockOut] = useState(false);
  const [mapViewport, setMapViewport] = useState<MapViewport>({ centerLat: 39.8283, centerLng: -98.5795, zoom: 4 });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editEntry, setEditEntry] = useState<EditEntryState | null>(null);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkState, setBulkState] = useState<BulkState>(() => ({
    date: todayInput(),
    jobId: '',
    notes: '',
    defaultHours: '8',
    roleFilters: new Set(defaultRoles),
    selected: new Set(),
    hours: {},
  }));
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const [reviewJobsBySession, setReviewJobsBySession] = useState<Record<string, string>>({});
  const mapDragRef = useRef<MapDragState | null>(null);
  const canManage = Boolean(punchStatus.canManage);
  const isCrewOnly = Boolean(punchStatus.member && !canManage);

  const weekEndExclusive = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const displayViewMode = isCrewOnly ? 'day' : viewMode;

  const sortedJobs = useMemo(() => {
    const latestByJob = entries.reduce((latest, entry) => {
      if (!entry.jobId) return latest;
      const value = Math.max(
        timeSortValue(entry.actualEndAt),
        timeSortValue(entry.roundedEndAt),
        timeSortValue(entry.date),
        timeSortValue(entry.createdAt),
      );
      latest.set(entry.jobId, Math.max(latest.get(entry.jobId) || 0, value));
      return latest;
    }, new Map<string, number>());
    return [...jobs].sort((a, b) => {
      const aLatest = latestByJob.get(a.id) || 0;
      const bLatest = latestByJob.get(b.id) || 0;
      if (aLatest !== bLatest) return bLatest - aLatest;
      return Math.max(timeSortValue(b.scheduledStartAt), timeSortValue(b.updatedAt), timeSortValue(b.createdAt))
        - Math.max(timeSortValue(a.scheduledStartAt), timeSortValue(a.updatedAt), timeSortValue(a.createdAt));
    });
  }, [entries, jobs]);

  const activePunchJobs = useMemo(() => {
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const source = punchStatus.jobs?.length ? punchStatus.jobs : jobs;
    return source.map((job) => ({ ...jobsById.get(job.id), ...job })).filter((job) => job.id) as Job[];
  }, [jobs, punchStatus.jobs]);

  const weekEntries = useMemo(() => entries.filter((entry) => {
    const date = new Date(entry.date);
    return date >= weekStart && date < weekEndExclusive;
  }), [entries, weekEndExclusive, weekStart]);

  const summary = useMemo(() => {
    const totalHours = weekEntries.reduce((sum, entry) => sum + numberValue(entry.hours), 0);
    const totalCost = weekEntries.reduce((sum, entry) => sum + numberValue(entry.totalCost), 0);
    const crew = new Set(weekEntries.map((entry) => entry.teamMemberId)).size;
    const review = weekEntries.filter((entry) => ['flagged', 'rejected'].includes(String(entry.reviewStatus || ''))).length;
    const overrides = weekEntries.filter((entry) => entry.source === 'punch_clock' && entry.reviewReason).length;
    return { totalHours, totalCost, crew, review, overrides };
  }, [weekEntries]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, TimeEntry[]>();
    weekEntries.forEach((entry) => {
      const key = displayViewMode === 'day'
        ? dateKey(entry.date)
        : displayViewMode === 'job'
          ? entry.jobId || 'unassigned-job'
          : entry.teamMemberId;
      groups.set(key, [...(groups.get(key) || []), entry]);
    });
    const rows = Array.from(groups.entries()).map(([key, groupEntries]) => ({ key, entries: groupEntries }));
    if (displayViewMode === 'day') return rows.sort((a, b) => b.key.localeCompare(a.key));
    return rows.sort((a, b) => (
      b.entries.reduce((sum, entry) => sum + numberValue(entry.hours), 0)
      - a.entries.reduce((sum, entry) => sum + numberValue(entry.hours), 0)
    ));
  }, [displayViewMode, weekEntries]);

  const availableRoles = useMemo(() => {
    const roles = Array.from(new Set(members.filter((member) => member.isActive !== false).map((member) => member.role || 'crew')));
    return roles.sort((a, b) => {
      const order = ['crew_lead', 'painter', 'prep'];
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      return (roleLabels[a] || a).localeCompare(roleLabels[b] || b);
    });
  }, [members]);

  const visibleBulkMembers = useMemo(() => members
    .filter((member) => member.isActive !== false)
    .filter((member) => bulkState.roleFilters.has(member.role || 'crew')), [bulkState.roleFilters, members]);

  const selectedBulkEntries = useMemo(() => members
    .filter((member) => member.isActive !== false && bulkState.selected.has(member.id))
    .map((member) => ({
      member,
      hours: numberValue(bulkState.hours[member.id] || bulkState.defaultHours),
    }))
    .filter((row) => row.hours > 0), [bulkState.defaultHours, bulkState.hours, bulkState.selected, members]);

  const bulkAverageHours = selectedBulkEntries.length
    ? selectedBulkEntries.reduce((sum, row) => sum + row.hours, 0) / selectedBulkEntries.length
    : 0;
  const hiddenBulkSelections = selectedBulkEntries.filter((row) => !visibleBulkMembers.some((member) => member.id === row.member.id)).length;

  async function loadData({ keepLoading = false } = {}) {
    if (!keepLoading) setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        start: weekStart.toISOString(),
        end: weekEndExclusive.toISOString(),
      });
      const [timeResponse, punchResponse] = await Promise.all([
        apiJson<{ data: TimeEntry[] }>(`/v1/team/time?${params.toString()}`),
        apiJson<{ data: PunchStatus }>('/v1/team/punch/status').catch((err): { data: PunchStatus } => ({ data: { memberResolutionError: err instanceof Error ? err.message : 'Failed to load punch status' } })),
      ]);
      const status = punchResponse.data || {};
      const canManageTime = Boolean(status.canManage);
      const [memberResponse, jobsResponse] = canManageTime
        ? await Promise.all([
            apiJson<{ data: TeamMember[] }>('/v1/team/members'),
            apiJson<{ data: Job[] }>('/v1/jobs'),
          ])
        : [
            { data: status.member ? [status.member] : [] },
            { data: status.jobs || [] },
          ];
      setEntries(timeResponse.data || []);
      setPunchStatus(status);
      setMembers(memberResponse.data || []);
      setJobs(jobsResponse.data || []);
      setSelectedPunchMemberId(status.member?.id || '');
      setReviewJobsBySession(Object.fromEntries((status.reviewQueue || []).map((row: PunchSession) => [row.id, row.jobId || ''])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time tracking');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMapData() {
    if (!canManage || mapCollapsed) return;
    setIsMapLoading(true);
    try {
      const start = new Date(mapDate);
      start.setHours(0, 0, 0, 0);
      const end = addDays(start, 1);
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
      const response = await apiJson<{ data: MapPayload }>(`/v1/team/time/map?${params.toString()}`);
      setMapData(response.data || { events: [] });
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to load crew map', 'error');
      setMapData({ events: [] });
    } finally {
      setIsMapLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [weekStart.getTime()]);

  useEffect(() => {
    loadMapData();
  }, [canManage, mapCollapsed, mapDate.getTime()]);

  useEffect(() => {
    const events = mapData.events || [];
    if (!events.length) {
      setMapViewport({ centerLat: 39.8283, centerLng: -98.5795, zoom: 4 });
      return;
    }
    const bounds = events.reduce((acc, event) => ({
      minLat: Math.min(acc.minLat, event.latitude),
      maxLat: Math.max(acc.maxLat, event.latitude),
      minLng: Math.min(acc.minLng, event.longitude),
      maxLng: Math.max(acc.maxLng, event.longitude),
    }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
    setMapViewport({
      centerLat: events.reduce((sum, event) => sum + event.latitude, 0) / events.length,
      centerLng: events.reduce((sum, event) => sum + event.longitude, 0) / events.length,
      zoom: mapZoomForSpan(Math.max(0.001, bounds.maxLat - bounds.minLat), Math.max(0.001, bounds.maxLng - bounds.minLng)),
    });
  }, [mapData.events]);

  useEffect(() => {
    localStorage.setItem(viewStorageKey, viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(mapStorageKey, String(mapCollapsed));
  }, [mapCollapsed]);

  function openBulkModal() {
    const activeMembers = members.filter((member) => member.isActive !== false);
    setBulkState({
      date: todayInput(),
      jobId: '',
      notes: '',
      defaultHours: '8',
      roleFilters: new Set(defaultRoles),
      selected: new Set(activeMembers.map((member) => member.id)),
      hours: Object.fromEntries(activeMembers.map((member) => [member.id, '8'])),
    });
    setShowBulkModal(true);
  }

  async function refreshPunchStatus() {
    await loadData({ keepLoading: true });
    setConfirmedLongClockOut(false);
  }

  function selectedTeamMemberId() {
    return selectedPunchMemberId || undefined;
  }

  async function punchIn(forgot = false) {
    if (punching) return;
    if (forgot && (!forgotClockInAt || !forgotClockInNote.trim())) {
      window.showToast?.('Enter the clock-in time and reason', 'error');
      return;
    }
    setPunching(true);
    try {
      const location = await requestLocation();
      await apiJson('/v1/team/punch/in', {
        method: 'POST',
        headers: postHeaders(),
        body: JSON.stringify({
          ...location,
          jobId: selectedPunchJobId || undefined,
          teamMemberId: selectedTeamMemberId(),
          forgotPunchIn: forgot,
          startedAt: forgot ? new Date(forgotClockInAt).toISOString() : undefined,
          note: forgot
            ? forgotClockInNote.trim()
            : selectedPunchJobId ? undefined : 'Crew clocked in without selecting a job.',
        }),
      });
      setShowForgotClockInModal(false);
      window.showToast?.(forgot || !selectedPunchJobId ? 'Clock-in created for review' : 'Clocked in', 'success');
      await refreshPunchStatus();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Punch failed', 'error');
    } finally {
      setPunching(false);
    }
  }

  async function punchOut() {
    if (punching) return;
    const active = punchStatus.activeSession;
    const threshold = punchStatus.settings?.clockOutWarningHours || 8;
    const hoursWorked = activePunchHours(active);
    if (!showForgotClockOut && !confirmedLongClockOut && hoursWorked > threshold) {
      setShowLongShiftModal(true);
      return;
    }
    if (showForgotClockOut && !forgotClockOutAt) {
      window.showToast?.('Enter the actual clock-out time for review', 'error');
      return;
    }
    setPunching(true);
    try {
      const location = await requestLocation();
      await apiJson('/v1/team/punch/out', {
        method: 'POST',
        headers: postHeaders(),
        body: JSON.stringify({
          ...location,
          teamMemberId: selectedTeamMemberId(),
          endedAt: showForgotClockOut ? new Date(forgotClockOutAt).toISOString() : undefined,
          note: showForgotClockOut ? forgotClockOutNote.trim() : undefined,
          overrideReason: showForgotClockOut ? forgotClockOutNote.trim() || 'Forgot to clock out earlier' : undefined,
        }),
      });
      setShowForgotClockOut(false);
      setConfirmedLongClockOut(false);
      window.showToast?.('Clocked out', 'success');
      await refreshPunchStatus();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Punch failed', 'error');
    } finally {
      setPunching(false);
    }
  }

  async function switchJob() {
    if (!switchJobId) {
      window.showToast?.('Select the next job first', 'error');
      return;
    }
    setPunching(true);
    try {
      const location = await requestLocation();
      await apiJson('/v1/team/punch/switch-job', {
        method: 'POST',
        headers: postHeaders(),
        body: JSON.stringify({
          ...location,
          teamMemberId: selectedTeamMemberId(),
          jobId: switchJobId,
        }),
      });
      setShowSwitchJobModal(false);
      setSwitchJobId('');
      window.showToast?.('Switched job', 'success');
      await refreshPunchStatus();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to switch job', 'error');
    } finally {
      setPunching(false);
    }
  }

  async function reviewPunch(id: string, status: ReviewStatus) {
    const row = punchStatus.reviewQueue?.find((item) => item.id === id);
    const jobId = reviewJobsBySession[id] || undefined;
    if (status === 'approved' && !row?.jobId && !jobId) {
      window.showToast?.('Assign a job before approving this punch', 'error');
      return;
    }
    try {
      await apiJson(`/v1/team/punch/review/${id}`, {
        method: 'PATCH',
        headers: patchHeaders(),
        body: JSON.stringify({ reviewStatus: status, jobId }),
      });
      window.showToast?.(status === 'approved' ? 'Punch approved' : 'Punch rejected', 'success');
      await refreshPunchStatus();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update punch', 'error');
    }
  }

  function openEditEntry(entry?: TimeEntry) {
    setEditEntry(entry ? {
      id: entry.id,
      teamMemberId: entry.teamMemberId,
      jobId: entry.jobId || '',
      date: toDateInput(entry.date),
      hours: String(entry.hours || ''),
      description: entry.description || '',
    } : {
      teamMemberId: '',
      jobId: '',
      date: todayInput(),
      hours: '',
      description: '',
    });
    setShowEditModal(true);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!editEntry) return;
    setIsSavingEntry(true);
    try {
      const body = {
        teamMemberId: editEntry.teamMemberId,
        jobId: editEntry.jobId,
        hours: Number(editEntry.hours),
        date: localIsoFromDateInput(editEntry.date),
        description: editEntry.description.trim() || undefined,
      };
      await apiJson(editEntry.id ? `/v1/team/time/${editEntry.id}` : '/v1/team/time', {
        method: editEntry.id ? 'PATCH' : 'POST',
        headers: editEntry.id ? patchHeaders() : postHeaders(),
        body: JSON.stringify(body),
      });
      setShowEditModal(false);
      window.showToast?.(editEntry.id ? 'Time entry updated' : 'Time entry logged', 'success');
      await loadData({ keepLoading: true });
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save time entry', 'error');
    } finally {
      setIsSavingEntry(false);
    }
  }

  async function removeEntry(id: string) {
    const entry = entries.find((item) => item.id === id);
    const label = entry ? `${entry.teamMemberName || 'Crew member'} on ${formatDate(entry.date)}` : 'this time entry';
    if (!window.confirm(`Remove ${label}? This will reverse its labor cost from the job.`)) return;
    try {
      await apiJson(`/v1/team/time/${id}`, { method: 'DELETE' });
      window.showToast?.('Time entry removed', 'success');
      await loadData({ keepLoading: true });
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to remove time entry', 'error');
    }
  }

  async function saveBulkTime(event: FormEvent) {
    event.preventDefault();
    if (!bulkState.jobId) {
      window.showToast?.('Select a job first', 'error');
      return;
    }
    const selected = selectedBulkEntries.map(({ member, hours }) => ({
      teamMemberId: member.id,
      hours,
      description: bulkState.notes.trim() || 'Crew labor',
    }));
    if (!selected.length) {
      window.showToast?.('Select at least one crew member with hours', 'error');
      return;
    }
    setIsSavingBulk(true);
    try {
      await apiJson('/v1/team/timecards', {
        method: 'POST',
        headers: postHeaders(),
        body: JSON.stringify({
          jobId: bulkState.jobId,
          date: bulkState.date,
          notes: bulkState.notes.trim() || undefined,
          entries: selected,
        }),
      });
      setShowBulkModal(false);
      window.showToast?.(`Logged time for ${selected.length} crew members`, 'success');
      await loadData({ keepLoading: true });
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to log crew time', 'error');
    } finally {
      setIsSavingBulk(false);
    }
  }

  function toggleBulkRole(role: string) {
    setBulkState((current) => {
      const next = new Set(current.roleFilters);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { ...current, roleFilters: next };
    });
  }

  function toggleVisibleBulkMembers() {
    setBulkState((current) => {
      const next = new Set(current.selected);
      const visibleIds = visibleBulkMembers.map((member) => member.id);
      const shouldSelect = visibleIds.some((id) => !next.has(id));
      visibleIds.forEach((id) => {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      });
      return { ...current, selected: next };
    });
  }

  function updateBulkDefaultHours(value: string) {
    setBulkState((current) => ({
      ...current,
      defaultHours: value,
      hours: Object.fromEntries(members.filter((member) => member.isActive !== false).map((member) => [member.id, value])),
    }));
  }

  function weekRangeLabel() {
    return `${formatDate(weekStart.toISOString(), { month: 'short', day: 'numeric' })} - ${formatDate(addDays(weekStart, 6).toISOString(), { month: 'short', day: 'numeric' })}`;
  }

  function groupHeader(groupKey: string, groupEntries: TimeEntry[]) {
    if (displayViewMode === 'day') return { title: groupTitleDate(groupKey), subtitle: `${groupEntries.length} ${groupEntries.length === 1 ? 'entry' : 'entries'}` };
    if (displayViewMode === 'job') {
      return {
        title: groupEntries[0]?.jobName || 'Unassigned job',
        subtitle: `${new Set(groupEntries.map((entry) => entry.teamMemberId)).size} crew - ${groupEntries.length} ${groupEntries.length === 1 ? 'entry' : 'entries'}`,
      };
    }
    return {
      title: groupEntries[0]?.teamMemberName || 'Crew member',
      subtitle: `${new Set(groupEntries.map((entry) => entry.jobId)).size} jobs - ${groupEntries.length} ${groupEntries.length === 1 ? 'entry' : 'entries'}`,
    };
  }

  function zoomMap(delta: number) {
    setMapViewport((current) => ({
      ...current,
      zoom: Math.max(3, Math.min(18, current.zoom + delta)),
    }));
  }

  function resetMapView() {
    const events = mapData.events || [];
    if (!events.length) {
      setMapViewport({ centerLat: 39.8283, centerLng: -98.5795, zoom: 4 });
      return;
    }
    const bounds = events.reduce((acc, event) => ({
      minLat: Math.min(acc.minLat, event.latitude),
      maxLat: Math.max(acc.maxLat, event.latitude),
      minLng: Math.min(acc.minLng, event.longitude),
      maxLng: Math.max(acc.maxLng, event.longitude),
    }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 });
    setMapViewport({
      centerLat: events.reduce((sum, event) => sum + event.latitude, 0) / events.length,
      centerLng: events.reduce((sum, event) => sum + event.longitude, 0) / events.length,
      zoom: mapZoomForSpan(Math.max(0.001, bounds.maxLat - bounds.minLat), Math.max(0.001, bounds.maxLng - bounds.minLng)),
    });
  }

  function startMapPan(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('a, button')) return;
    const centerPixel = latLngToWorldPixel(mapViewport.centerLat, mapViewport.centerLng, mapViewport.zoom);
    mapDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerPixelX: centerPixel.x,
      centerPixelY: centerPixel.y,
      zoom: mapViewport.zoom,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveMapPan(event: PointerEvent<HTMLDivElement>) {
    const drag = mapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextCenter = worldPixelToLatLng(
      drag.centerPixelX - (event.clientX - drag.startX),
      drag.centerPixelY - (event.clientY - drag.startY),
      drag.zoom,
    );
    setMapViewport((current) => ({
      ...current,
      centerLat: nextCenter.latitude,
      centerLng: nextCenter.longitude,
    }));
  }

  function endMapPan(event: PointerEvent<HTMLDivElement>) {
    if (mapDragRef.current?.pointerId === event.pointerId) {
      mapDragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  const initialLoading = isLoading
    && !error
    && !entries.length
    && !punchStatus.member
    && !punchStatus.activeSession
    && !punchStatus.memberResolutionError;

  if (initialLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <p className="pf-copy mb-5 max-w-2xl">Loading time clock, crew approvals, and weekly timecards.</p>
        <Card className="mb-5">
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
            <p className="pf-section-title mt-4">Loading time tracking</p>
            <p className="pf-copy mt-1 max-w-md">Getting punch status, crew permissions, jobs, and the current week.</p>
          </div>
        </Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <Card>
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-36 rounded bg-gray-200" />
              <div className="h-20 rounded-xl bg-gray-100" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-11 rounded bg-gray-100" />
                <div className="h-11 rounded bg-gray-100" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-32 rounded bg-gray-200" />
              <div className="h-16 rounded bg-gray-100" />
              <div className="h-16 rounded bg-gray-100" />
            </div>
          </Card>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {['Hours', 'Labor cost', 'Crew', 'Needs review', 'Overrides'].map((label) => (
            <Card key={label} padding="sm">
              <div className="animate-pulse space-y-2">
                <p className="pf-label-small uppercase tracking-wide text-gray-500">{label}</p>
                <div className="h-7 w-14 rounded bg-gray-100" />
                <div className="h-3 w-24 rounded bg-gray-100" />
              </div>
            </Card>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="pf-copy max-w-2xl">
          {isCrewOnly
            ? 'Clock in, clock out, and review your own timecards. Location is captured for each punch.'
            : 'Review daily timecards, approve exceptions, and log crew hours without touching pay rates.'}
        </p>
        {canManage && (
          <Button onClick={openBulkModal} className="w-full sm:w-auto" leftIcon={<Icon name="clock" className="h-4 w-4" />}>
            Log crew time
          </Button>
        )}
      </div>

      {error && (
        <Card className="mb-5 border-red-100 bg-red-50" padding="sm">
          <p className="pf-copy text-red-700">{error}</p>
        </Card>
      )}

      <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        {renderPunchClock()}
        {canManage && renderTimeApprovals()}
      </section>

      {canManage && renderMapPanel()}

      <Card className="mb-5" padding="sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 lg:max-w-md">
            <button className="btn-icon btn-icon-outlined" aria-label="Previous week" onClick={() => setWeekStart((current) => addDays(current, -7))}>
              <Icon name="chevron-left" className="h-4 w-4" />
            </button>
            <p className="pf-emphasis text-center">{weekRangeLabel()}</p>
            <button className="btn-icon btn-icon-outlined" aria-label="Next week" onClick={() => setWeekStart((current) => addDays(current, 7))}>
              <Icon name="chevron-right" className="h-4 w-4" />
            </button>
          </div>
          {!isCrewOnly && (
            <div className="pf-segmented-group justify-center lg:justify-end" aria-label="Time grouping">
              {(['day', 'job', 'employee'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={viewMode === mode ? 'view-mode-active' : ''}
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                >
                  {labelize(mode)}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className={`mb-5 grid grid-cols-2 gap-3 ${canManage ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <StatusMetric label="Hours" value={formatHours(summary.totalHours)} help={isCrewOnly ? 'Your logged time' : 'Logged this week'} />
        {canManage && <StatusMetric label="Labor cost" value={formatMoney(summary.totalCost)} help="Burdened job cost" />}
        <StatusMetric label={canManage ? 'Crew' : 'Entries'} value={canManage ? summary.crew : weekEntries.length} help={canManage ? 'People with entries' : 'Timecards on record'} />
        <StatusMetric label="Needs review" value={summary.review} help="Flagged punches" />
        <StatusMetric label="Overrides" value={summary.overrides} help="Forgotten or adjusted punches" />
      </div>

      {isLoading ? (
        <div className="py-12 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="pf-copy mt-4">Loading timesheet...</p>
        </div>
      ) : weekEntries.length ? (
        <div className="space-y-4">
          {groupedEntries.map(({ key, entries: groupEntries }) => renderTimeGroup(`${displayViewMode}:${key}`, key, groupEntries))}
        </div>
      ) : (
        <Card className="py-12 text-center">
          <p className="pf-copy">No time entries this week.</p>
          {canManage && (
            <Button size="sm" className="mt-4" onClick={openBulkModal}>
              Log crew time
            </Button>
          )}
        </Card>
      )}

      {renderEntryModal()}
      {renderBulkModal()}
      {renderForgotClockInModal()}
      {renderSwitchJobModal()}
      {renderLongShiftModal()}
    </main>
  );

  function renderPunchClock() {
    const active = punchStatus.activeSession;
    const resolutionError = punchStatus.memberResolutionError && !canManage;
    return (
      <Card className={active ? 'border-green-100' : ''}>
        <CardHeader title="Mobile time clock" description={resolutionError ? undefined : 'Crew punches require location permission.'} />
        {resolutionError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 p-4">
            <p className="pf-copy text-red-700">{punchStatus.memberResolutionError}</p>
            <p className="pf-helper mt-2">Ask an owner to link your login email to an active crew member on the Team page.</p>
          </div>
        ) : active ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-100 bg-green-50 p-4">
              <Badge variant="success">Clocked in</Badge>
              <p className="pf-value mt-3 text-green-950">{active.jobName || 'Unassigned job'}</p>
              <p className="pf-copy mt-1">
                Started {formatDateTime(active.startedAtActual)} - {activePunchHours(active).toFixed(2)} hrs
              </p>
              {active.status === 'missed_clock_out' && (
                <p className="pf-copy mt-2 text-red-700">This shift is past the configured maximum length.</p>
              )}
            </div>

            {showForgotClockOut && (
              <div className="grid gap-3 rounded-lg border border-amber-100 bg-amber-50 p-3 sm:grid-cols-2">
                <label>
                  <span className="form-label">Actual clock-out time</span>
                  <input className="input" type="datetime-local" value={forgotClockOutAt} onChange={(event) => setForgotClockOutAt(event.target.value)} />
                </label>
                <label>
                  <span className="form-label">Reason for lead review</span>
                  <input className="input" value={forgotClockOutNote} onChange={(event) => setForgotClockOutNote(event.target.value)} placeholder="Finished earlier, forgot to clock out" />
                </label>
              </div>
            )}

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Button variant="danger" isLoading={punching} onClick={punchOut}>
                Clock out
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowForgotClockOut((current) => !current);
                  setForgotClockOutAt(toDateTimeLocal());
                }}
              >
                I forgot earlier
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSwitchJobId('');
                  setShowSwitchJobModal(true);
                }}
              >
                Change job
              </Button>
            </div>
          </div>
        ) : (
          <div className={`grid gap-3 ${canManage ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]' : 'lg:grid-cols-[minmax(0,1fr)_auto]'} lg:items-end`}>
            {canManage && (
              <label>
                <span className="form-label">Crew member</span>
                <select className="input" value={selectedPunchMemberId} onChange={(event) => setSelectedPunchMemberId(event.target.value)}>
                  {(punchStatus.members || []).map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="form-label inline-flex items-center gap-2">
                Job
                {!selectedPunchJobId && warningIcon('Select a job before clocking in. If no job is selected, the shift is saved but flagged for crew lead review before approval.')}
              </span>
              <select className="input" value={selectedPunchJobId} onChange={(event) => setSelectedPunchJobId(event.target.value)}>
                <option value="">No job selected</option>
                {activePunchJobs.map((job) => (
                  <option key={job.id} value={job.id}>{jobLabel(job)}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button isLoading={punching} onClick={() => punchIn(false)}>
                Clock in
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setForgotClockInAt(toDateTimeLocal());
                  setForgotClockInNote('Forgot to clock in; entered later from the app.');
                  setShowForgotClockInModal(true);
                }}
              >
                Forgot clock-in
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  function renderTimeApprovals() {
    const rows = punchStatus.reviewQueue || [];
    return (
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2">Time approvals <Badge size="sm">{rows.length}</Badge></span>}
          description="Review missed punches, long shifts, and missing job assignments."
        />
        <CardContent className="space-y-3">
          {rows.length ? rows.map((row) => (
            <article key={row.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="pf-emphasis truncate">{row.teamMemberName || 'Crew member'}</p>
                  <p className="pf-copy truncate">{row.jobName || 'Unassigned job'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="danger" size="sm">{row.reviewLabel || reviewReasonText(row.reviewReason)}</Badge>
                    <span className="pf-helper">Started {formatDateTime(row.startedAtActual)}</span>
                    <span className="pf-helper">{row.endedAtActual ? `Ended ${formatDateTime(row.endedAtActual)}` : 'Still needs clock-out'}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <MapLinkButton latitude={row.startLatitude} longitude={row.startLongitude} label="Start GPS" />
                  <MapLinkButton latitude={row.endLatitude} longitude={row.endLongitude} label="End GPS" />
                </div>
              </div>
              {!row.jobId && (
                <label className="mt-3 block">
                  <span className="form-label">Assign job before approval</span>
                  <select
                    className="input"
                    value={reviewJobsBySession[row.id] || ''}
                    onChange={(event) => setReviewJobsBySession((current) => ({ ...current, [row.id]: event.target.value }))}
                  >
                    <option value="">Assign job...</option>
                    {sortedJobs.map((job) => <option key={job.id} value={job.id}>{jobLabel(job)}</option>)}
                  </select>
                </label>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="success" disabled={!row.endedAtActual} onClick={() => reviewPunch(row.id, 'approved')}>
                  Approve
                </Button>
                <Button size="sm" variant="dangerSubtle" onClick={() => reviewPunch(row.id, 'rejected')}>
                  Reject
                </Button>
              </div>
            </article>
          )) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="pf-copy">No time entries need approval right now.</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function renderMapPanel() {
    const events = mapData.events || [];
    const { centerLat, centerLng, zoom } = mapViewport;
    const centerPixel = latLngToWorldPixel(centerLat, centerLng, zoom);
    const centerTileX = Math.floor(centerPixel.x / 256);
    const centerTileY = Math.floor(centerPixel.y / 256);
    const tileOriginX = (centerTileX - 2) * 256;
    const tileOriginY = (centerTileY - 2) * 256;
    const tileCount = 2 ** zoom;
    const tiles = [-2, -1, 0, 1, 2].flatMap((yOffset) => [-2, -1, 0, 1, 2].map((xOffset) => ({
      key: `${xOffset}:${yOffset}`,
      x: centerTileX + xOffset,
      y: centerTileY + yOffset,
      xOffset,
      yOffset,
    }))).filter((tile) => tile.y >= 0 && tile.y < tileCount);

    return (
      <Card className="mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardHeader className={mapCollapsed ? 'mb-0' : ''} title="GPS punch map" description={mapCollapsed ? undefined : 'Shows GPS points captured at clock-in and clock-out only.'} />
          </div>
          <div className="flex flex-col gap-2 sm:min-w-72">
            <Button variant="secondary" size="sm" onClick={() => setMapCollapsed((current) => !current)}>
              {mapCollapsed ? 'Show map' : 'Hide map'}
            </Button>
            {!mapCollapsed && (
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                <button className="btn-icon btn-icon-outlined" aria-label="Previous map day" onClick={() => setMapDate((current) => addDays(current, -1))}>
                  <Icon name="chevron-left" className="h-4 w-4" />
                </button>
                <p className="pf-emphasis text-center">{formatDate(mapDate.toISOString(), { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                <button className="btn-icon btn-icon-outlined" aria-label="Next map day" onClick={() => setMapDate((current) => addDays(current, 1))}>
                  <Icon name="chevron-right" className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        {!mapCollapsed && (
          <div className="mt-4">
            <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                ['Clock-ins', mapData.summary?.clockIns || 0],
                ['Clock-outs', mapData.summary?.clockOuts || 0],
                ['Crew', mapData.summary?.employees || 0],
                ['Jobs', mapData.summary?.jobs || 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="pf-label-small">{label}</p>
                  <p className="pf-emphasis">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
              <div
                className="relative min-h-80 cursor-grab touch-none overflow-hidden rounded-xl border border-gray-200 bg-slate-100 active:cursor-grabbing"
                onPointerDown={startMapPan}
                onPointerMove={moveMapPan}
                onPointerUp={endMapPan}
                onPointerCancel={endMapPan}
              >
                {isMapLoading ? (
                  <p className="pf-copy p-4">Loading punch locations...</p>
                ) : (
                  <>
                    <div
                      className="absolute grid h-[1280px] w-[1280px] grid-cols-5 grid-rows-5 opacity-95"
                      style={{
                        left: `calc(50% - ${centerPixel.x - tileOriginX}px)`,
                        top: `calc(50% - ${centerPixel.y - tileOriginY}px)`,
                      }}
                    >
                      {tiles.map((tile) => (
                        <img
                          key={tile.key}
                          alt=""
                          className="h-64 w-64 select-none"
                          draggable={false}
                          src={`https://tile.openstreetmap.org/${zoom}/${((tile.x % tileCount) + tileCount) % tileCount}/${tile.y}.png`}
                          style={{ gridColumnStart: tile.xOffset + 3, gridRowStart: tile.yOffset + 3 }}
                        />
                      ))}
                    </div>
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-white/20" />
                    <div className="absolute left-2 top-2 z-10 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                      <button type="button" className="btn-icon rounded-none border-0" aria-label="Zoom in" onClick={() => zoomMap(1)}>
                        <Icon name="plus" className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-icon rounded-none border-0 border-t border-gray-200" aria-label="Zoom out" onClick={() => zoomMap(-1)}>
                        <Icon name="minus" className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-icon rounded-none border-0 border-t border-gray-200" aria-label="Reset map view" onClick={resetMapView}>
                        <Icon name="refresh" className="h-4 w-4" />
                      </button>
                    </div>
                    {!events.length && (
                      <div className="absolute left-1/2 top-1/2 z-10 w-[min(18rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white/95 p-4 text-center shadow-sm">
                        <p className="pf-emphasis">No GPS punches for this day</p>
                        <p className="pf-helper mt-1">Use the day controls above to review another crew location snapshot.</p>
                      </div>
                    )}
                    {events.map((event) => {
                      const pixel = latLngToWorldPixel(event.latitude, event.longitude, zoom);
                      const left = `calc(50% + ${pixel.x - centerPixel.x}px)`;
                      const top = `calc(50% + ${pixel.y - centerPixel.y}px)`;
                      const isOut = event.type.includes('clock_out');
                      return (
                        <a
                          key={event.id}
                          href={mapHref(event.latitude, event.longitude)}
                          target="_blank"
                          rel="noreferrer"
                          className={`absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full border-2 border-white text-xs font-semibold shadow-lg ${event.reviewRequired ? 'bg-amber-500 text-white' : isOut ? 'bg-slate-700 text-white' : 'bg-green-600 text-white'}`}
                          style={{ left, top }}
                          title={`${event.teamMemberName || 'Crew member'} ${eventTypeLabel(event.type)}`}
                        >
                          {event.reviewRequired ? '!' : isOut ? 'Out' : 'In'}
                          <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-inherit" />
                        </a>
                      );
                    })}
                    <a
                      href={`https://www.openstreetmap.org/#map=${zoom}/${centerLat}/${centerLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute bottom-2 right-2 rounded bg-white/90 px-2 py-1 text-[11px] font-medium text-gray-700 shadow-sm"
                    >
                      Open map
                    </a>
                  </>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="pf-section-title">Punches</h3>
                  <Button variant="ghost" size="sm" onClick={loadMapData}>Refresh</Button>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <a key={event.id} href={mapHref(event.latitude, event.longitude)} target="_blank" rel="noreferrer" className="block rounded-lg border border-gray-200 bg-white p-3 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="pf-emphasis truncate">{event.teamMemberName || 'Crew member'}</p>
                          <p className="pf-helper">{eventTypeLabel(event.type)} - {formatTime(event.occurredAt)}</p>
                        </div>
                        {event.reviewRequired && <Badge variant="warning" size="sm">Review</Badge>}
                      </div>
                      <p className="pf-helper mt-1 truncate">{event.jobName || 'Unassigned job'}</p>
                      {event.address && <p className="pf-helper truncate">{formatAddress(event.address).replace(/\s+\d{5}$/, '')}</p>}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>
    );
  }

  function renderTimeGroup(groupId: string, groupKey: string, groupEntries: TimeEntry[]) {
    const header = groupHeader(groupKey, groupEntries);
    const totalHours = groupEntries.reduce((sum, entry) => sum + numberValue(entry.hours), 0);
    const totalCost = groupEntries.reduce((sum, entry) => sum + numberValue(entry.totalCost), 0);
    const collapsed = collapsedGroups.has(groupId);
    return (
      <Card key={groupId} padding="none" className="overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100"
          onClick={() => setCollapsedGroups((current) => {
            const next = new Set(current);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
          })}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="btn-icon h-7 w-7 shrink-0" aria-hidden="true">
              <Icon name={collapsed ? 'plus' : 'minus'} className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="pf-emphasis block truncate">{header.title}</span>
              <span className="pf-helper block truncate">{header.subtitle}</span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="pf-emphasis block">{formatHours(totalHours)} hrs</span>
            {canManage && <span className="pf-helper block">{formatMoney(totalCost)}</span>}
          </span>
        </button>
        {!collapsed && (
          <>
            <div className={`hidden gap-3 border-b border-gray-200 bg-white px-3 py-1.5 pf-label-small lg:grid ${canManage ? 'lg:grid-cols-[minmax(12rem,1.2fr)_minmax(9rem,0.85fr)_5rem_7rem_5.5rem]' : 'lg:grid-cols-[minmax(12rem,1fr)_5rem]'}`}>
              {timeColumns().map((column) => (
                <span key={column.key} className={column.align === 'right' ? 'text-right' : ''}>{column.label}</span>
              ))}
            </div>
            <div className="divide-y divide-gray-200">
              {groupEntries.map((entry) => renderTimeEntry(entry))}
            </div>
          </>
        )}
      </Card>
    );
  }

  function timeColumns(): TimeColumn[] {
    const base: Record<TimeColumn['key'], TimeColumn> = {
      date: { key: 'date', label: 'Date' },
      job: { key: 'job', label: 'Job' },
      employee: { key: 'employee', label: 'Employee' },
      hours: { key: 'hours', label: 'Hours', align: 'right' },
      cost: { key: 'cost', label: 'Cost', align: 'right' },
      actions: { key: 'actions', label: 'Actions', align: 'right' },
    };
    if (!canManage) return displayViewMode === 'job' ? [base.date, base.hours] : [base.job, base.hours];
    if (displayViewMode === 'day') return [base.job, base.employee, base.hours, base.cost, base.actions];
    if (displayViewMode === 'job') return [base.date, base.employee, base.hours, base.cost, base.actions];
    return [base.date, base.job, base.hours, base.cost, base.actions];
  }

  function renderTimeEntry(entry: TimeEntry) {
    const flagged = ['flagged', 'rejected'].includes(String(entry.reviewStatus || ''));
    const approvedOverride = entry.source === 'punch_clock' && entry.reviewReason && entry.reviewStatus === 'approved';
    const detailLine = [
      entry.description,
      entry.source === 'punch_clock' ? 'Punch clock' : null,
      flagged ? reviewReasonText(entry.reviewReason) : null,
      approvedOverride ? `Approved override: ${reviewReasonText(entry.reviewReason)}` : null,
    ].filter(Boolean).join(' - ');
    const date = formatDate(entry.date);
    const mobileTitle = displayViewMode === 'job' ? entry.teamMemberName || 'Crew member' : entry.jobName || 'Job';
    const mobileContext = canManage
      ? [displayViewMode === 'day' ? entry.teamMemberName : date, `${formatHours(entry.hours)} hrs`, formatMoney(entry.totalCost), detailLine].filter(Boolean).join(' - ')
      : [displayViewMode === 'job' ? date : entry.jobName, `${formatHours(entry.hours)} hrs`, detailLine].filter(Boolean).join(' - ');
    const cells: Record<string, JSX.Element> = {
      date: <p className="hidden truncate pf-helper lg:block">{date}</p>,
      job: (
        <div className="hidden min-w-0 lg:block">
          <p className="truncate pf-emphasis">
            {entry.jobName || 'Job'} {flagged && <Badge variant="danger" size="sm">Review</Badge>} {approvedOverride && <Badge size="sm">Override approved</Badge>}
          </p>
          {detailLine && <p className="truncate pf-helper">{detailLine}</p>}
        </div>
      ),
      employee: <p className="hidden truncate pf-emphasis lg:block">{entry.teamMemberName || 'Crew member'}</p>,
      hours: <p className="hidden text-right pf-emphasis lg:block">{formatHours(entry.hours)}</p>,
      cost: <p className="hidden text-right pf-emphasis lg:block">{formatMoney(entry.totalCost)}</p>,
      actions: (
        <div className="hidden justify-end gap-2 lg:flex">
          <button className="btn-icon btn-icon-tonal" aria-label="Edit time entry" title="Edit" onClick={() => openEditEntry(entry)}>
            <Icon name="edit" className="h-4 w-4" />
          </button>
          <button className="btn-icon btn-icon-outlined btn-icon-danger" aria-label="Remove time entry" title="Remove" onClick={() => removeEntry(entry.id)}>
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>
      ),
    };
    return (
      <article className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 hover:bg-gray-50 lg:items-center lg:gap-3 ${canManage ? 'lg:grid-cols-[minmax(12rem,1.2fr)_minmax(9rem,0.85fr)_5rem_7rem_auto]' : 'lg:grid-cols-[minmax(12rem,1fr)_5rem]'}`}>
        <div className="min-w-0 lg:hidden">
          <p className="truncate pf-emphasis">{mobileTitle}</p>
          <p className="truncate pf-helper">{mobileContext}</p>
        </div>
        {timeColumns().map((column) => <div key={column.key}>{cells[column.key]}</div>)}
        {canManage && (
          <div className="flex items-center gap-1 lg:hidden">
            <button className="btn-icon btn-icon-tonal" aria-label="Edit time entry" onClick={() => openEditEntry(entry)}>
              <Icon name="edit" className="h-4 w-4" />
            </button>
            <button className="btn-icon btn-icon-outlined btn-icon-danger" aria-label="Remove time entry" onClick={() => removeEntry(entry.id)}>
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </div>
        )}
        {canManage && entry.source === 'punch_clock' && (
          <details className="col-span-2 rounded-lg bg-gray-50 px-3 py-2 lg:col-span-full">
            <summary className="cursor-pointer pf-helper">Audit details - {formatTime(entry.actualStartAt)} - {formatTime(entry.actualEndAt)}</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <p className="pf-helper"><span className="block pf-label-small">Actual punch times</span>{formatTime(entry.actualStartAt)} - {formatTime(entry.actualEndAt)}</p>
              <p className="pf-helper"><span className="block pf-label-small">Rounded payroll</span>{formatTime(entry.roundedStartAt)} - {formatTime(entry.roundedEndAt)}</p>
              <p className="flex flex-wrap gap-2">
                <MapLinkButton latitude={entry.startLatitude} longitude={entry.startLongitude} label="Start GPS" />
                <MapLinkButton latitude={entry.endLatitude} longitude={entry.endLongitude} label="End GPS" />
              </p>
            </div>
          </details>
        )}
      </article>
    );
  }

  function renderEntryModal() {
    return (
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={editEntry?.id ? 'Edit Time Entry' : 'Log Time'}>
        {editEntry && (
          <form onSubmit={saveEntry} className="space-y-4">
            <p className="pf-copy">Labor cost is recalculated from the crew member's burdened rate.</p>
            <label className="block">
              <span className="form-label">Crew member</span>
              <select className="input" value={editEntry.teamMemberId} onChange={(event) => setEditEntry({ ...editEntry, teamMemberId: event.target.value })} required>
                <option value="">Select crew member...</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="form-label">Job</span>
              <select className="input" value={editEntry.jobId} onChange={(event) => setEditEntry({ ...editEntry, jobId: event.target.value })} required>
                <option value="">Select job...</option>
                {sortedJobs.map((job) => <option key={job.id} value={job.id}>{jobLabel(job)}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="form-label">Work date</span>
                <input type="date" className="input" value={editEntry.date} onChange={(event) => setEditEntry({ ...editEntry, date: event.target.value })} required />
              </label>
              <label>
                <span className="form-label">Hours</span>
                <input type="number" min="0" max="24" step="0.25" inputMode="decimal" className="input" value={editEntry.hours} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setEditEntry({ ...editEntry, hours: event.target.value })} required />
              </label>
            </div>
            <label className="block">
              <span className="form-label">Work performed</span>
              <input className="input" value={editEntry.description} onChange={(event) => setEditEntry({ ...editEntry, description: event.target.value })} placeholder="Prep, spray, trim, punch list" />
            </label>
            <ModalFooter className="-mx-6 -mb-4 mt-4">
              <Button type="button" variant="secondary" onClick={() => setShowEditModal(false)}>Cancel</Button>
              <Button type="submit" isLoading={isSavingEntry}>{editEntry.id ? 'Update time' : 'Save time'}</Button>
            </ModalFooter>
          </form>
        )}
      </Modal>
    );
  }

  function renderBulkModal() {
    const visibleIds = visibleBulkMembers.map((member) => member.id);
    const visibleAllSelected = visibleIds.length > 0 && visibleIds.every((id) => bulkState.selected.has(id));
    return (
      <Modal isOpen={showBulkModal} onClose={() => setShowBulkModal(false)} title="Log crew time" size="lg">
        <form onSubmit={saveBulkTime} className="space-y-4">
          <p className="pf-copy">Fast end-of-day entry for assigning hours to multiple crew members on one job.</p>
          <label className="block">
            <span className="form-label">Job</span>
            <select className="input" value={bulkState.jobId} onChange={(event) => setBulkState((current) => ({ ...current, jobId: event.target.value }))} required>
              <option value="">Select job...</option>
              {sortedJobs.map((job) => <option key={job.id} value={job.id}>{jobLabel(job)}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="form-label">Date</span>
              <input type="date" className="input" value={bulkState.date} onChange={(event) => setBulkState((current) => ({ ...current, date: event.target.value }))} required />
            </label>
            <label>
              <span className="form-label">Default hours</span>
              <input type="number" min="0" max="24" step="0.25" inputMode="decimal" className="input" value={bulkState.defaultHours} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateBulkDefaultHours(event.target.value)} />
            </label>
            <label>
              <span className="form-label">Notes</span>
              <input className="input" value={bulkState.notes} onChange={(event) => setBulkState((current) => ({ ...current, notes: event.target.value }))} placeholder="Crew labor" />
            </label>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <p className="pf-emphasis text-blue-950">{selectedBulkEntries.length} selected - {bulkAverageHours.toFixed(2).replace(/\.00$/, '')} hr avg - {formatHours(selectedBulkEntries.reduce((sum, row) => sum + row.hours, 0))} total hrs</p>
            {hiddenBulkSelections > 0 && <p className="pf-helper mt-1">{hiddenBulkSelections} selected employee{hiddenBulkSelections === 1 ? '' : 's'} hidden by filters.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {availableRoles.map((role) => (
              <button key={role} type="button" className={`pf-filter-chip ${bulkState.roleFilters.has(role) ? 'pf-filter-chip-active' : ''}`} onClick={() => toggleBulkRole(role)}>
                {roleLabels[role] || labelize(role)}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" disabled={!visibleIds.length} onClick={toggleVisibleBulkMembers}>
              {visibleAllSelected ? 'Clear visible' : 'Select visible'}
            </Button>
          </div>
          <div className="max-h-[50vh] divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200">
            {visibleBulkMembers.length ? visibleBulkMembers.map((member) => (
              <label key={member.id} className="grid grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-3 p-3 hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={bulkState.selected.has(member.id)}
                    onChange={(event) => setBulkState((current) => {
                      const selected = new Set(current.selected);
                      if (event.target.checked) selected.add(member.id);
                      else selected.delete(member.id);
                      return { ...current, selected };
                    })}
                  />
                  <span className="min-w-0">
                    <span className="block truncate pf-emphasis">{member.name}</span>
                    <span className="block pf-helper">{roleLabels[String(member.role || '')] || labelize(member.role)}</span>
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
                  value={bulkState.hours[member.id] || ''}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setBulkState((current) => ({ ...current, hours: { ...current.hours, [member.id]: event.target.value } }))}
                />
              </label>
            )) : (
              <div className="p-4">
                <p className="pf-copy">No crew match the selected roles.</p>
                <Link className="pf-helper text-blue-700" to="/team">Manage crew members</Link>
              </div>
            )}
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <Button type="button" variant="secondary" onClick={() => setShowBulkModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={isSavingBulk} disabled={!selectedBulkEntries.length}>Log crew time</Button>
          </ModalFooter>
        </form>
      </Modal>
    );
  }

  function renderForgotClockInModal() {
    return (
      <Modal isOpen={showForgotClockInModal} onClose={() => setShowForgotClockInModal(false)} title="Forgot clock-in">
        <form onSubmit={(event) => { event.preventDefault(); punchIn(true); }} className="space-y-4">
          <p className="pf-copy">Enter the actual start time and a note for lead review.</p>
          <label className="block">
            <span className="form-label">Actual clock-in time</span>
            <input type="datetime-local" className="input" value={forgotClockInAt} onChange={(event) => setForgotClockInAt(event.target.value)} required />
          </label>
          <label className="block">
            <span className="form-label">Reason for lead review</span>
            <textarea className="input min-h-24" maxLength={500} value={forgotClockInNote} onChange={(event) => setForgotClockInNote(event.target.value)} required />
          </label>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <Button type="button" variant="secondary" onClick={() => setShowForgotClockInModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={punching}>Submit for review</Button>
          </ModalFooter>
        </form>
      </Modal>
    );
  }

  function renderSwitchJobModal() {
    const active = punchStatus.activeSession;
    return (
      <Modal isOpen={showSwitchJobModal} onClose={() => setShowSwitchJobModal(false)} title="Change job">
        <form onSubmit={(event) => { event.preventDefault(); switchJob(); }} className="space-y-4">
          <p className="pf-copy">{active?.jobName ? `Current job: ${active.jobName}` : 'Move the active clock session to another job.'}</p>
          <label className="block">
            <span className="form-label">New job</span>
            <select className="input" value={switchJobId} onChange={(event) => setSwitchJobId(event.target.value)} required>
              <option value="">Select next job...</option>
              {activePunchJobs.filter((job) => job.id !== active?.jobId).map((job) => (
                <option key={job.id} value={job.id}>{jobLabel(job)}</option>
              ))}
            </select>
          </label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="pf-copy">This closes the current punch and starts a new punch on the selected job with GPS captured at the switch.</p>
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <Button type="button" variant="secondary" onClick={() => setShowSwitchJobModal(false)}>Cancel</Button>
            <Button type="submit" isLoading={punching}>Change job</Button>
          </ModalFooter>
        </form>
      </Modal>
    );
  }

  function renderLongShiftModal() {
    const active = punchStatus.activeSession;
    const hoursWorked = activePunchHours(active);
    const threshold = punchStatus.settings?.clockOutWarningHours || 8;
    return (
      <Modal isOpen={showLongShiftModal} onClose={() => setShowLongShiftModal(false)} title="Long shift check">
        <div className="space-y-4">
          <p className="pf-copy">This shift has been active for {hoursWorked.toFixed(2)} hours. Your company asks for confirmation after {threshold} hours.</p>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
            <p className="pf-copy">If you actually finished earlier, use the forgotten clock-out option so the corrected time is flagged for lead review.</p>
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowLongShiftModal(false);
                setShowForgotClockOut(true);
                setForgotClockOutAt(toDateTimeLocal());
              }}
            >
              I forgot earlier
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setShowLongShiftModal(false);
                setConfirmedLongClockOut(true);
                setTimeout(() => punchOut(), 0);
              }}
            >
              Clock out now
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    );
  }
}
