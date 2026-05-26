import { FormEvent, PointerEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { UpsellCard } from '@/components/UpsellCard';
import { API_URL, apiJson, formatAddress, formatMoney, labelize } from '@/lib/api';

const dayMs = 86_400_000;
const averageCrewSize = 3;
const crewHoursPerPersonDay = 8;

interface Job {
  id: string;
  jobNumber?: string | null;
  name?: string | null;
  status?: string | null;
  budget?: string | number | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  leadName?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  estimatedLaborHours?: string | number | null;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface TimeEntry {
  id: string;
  jobId?: string | null;
  hours?: string | number | null;
}

interface WeatherDay {
  date: string;
  weatherCode: number | null;
  high: number | null;
  low: number | null;
  precipProbability: number | null;
  precipAmount: number | null;
  windGust: number | null;
}

interface WeatherForecast {
  zipCode: string;
  label?: string;
  days: WeatherDay[];
}

interface CalendarWeatherResponse {
  data?: {
    zipCode?: string;
    businessZip?: string;
    forecast?: WeatherForecast | null;
    jobForecasts?: WeatherForecast[];
  };
}

interface QuickScheduleState {
  dayKey: string;
  jobId: string;
  durationDays: string;
}

interface DragState {
  jobId: string;
  startX: number;
  startY: number;
  active: boolean;
}

function getWeekStart(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = next.getDate() - day + (day === 0 ? -6 : 1);
  next.setHours(0, 0, 0, 0);
  next.setDate(diff);
  return next;
}

function getMonthStart(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(1);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  return next;
}

function dateKey(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function fromScheduleDate(value: string, endOfDay = false) {
  const date = localDateFromKey(value);
  date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return date.toISOString();
}

function formatDate(value: Date | string, options?: Intl.DateTimeFormatOptions) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, options || { month: 'short', day: 'numeric' });
}

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function activeJob(job: Job) {
  return !['completed', 'cancelled', 'canceled'].includes(String(job.status || '').toLowerCase());
}

function jobHasSchedule(job: Job) {
  return Boolean(job.scheduledStartAt);
}

function jobStart(job: Job) {
  return job.scheduledStartAt ? new Date(job.scheduledStartAt) : null;
}

function jobEnd(job: Job) {
  return job.scheduledEndAt ? new Date(job.scheduledEndAt) : jobStart(job);
}

function jobIntersectsDay(job: Job, day: Date) {
  const start = jobStart(job);
  if (!start) return false;
  const workDates = scheduledWorkDates(job);
  if (workDates.length) return workDates.includes(dateKey(day));
  const end = jobEnd(job) || start;
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  return start < dayEnd && end >= dayStart;
}

function estimatedWorkDays(job?: Job) {
  const estimatedHours = numberValue(job?.estimatedLaborHours);
  if (!Number.isFinite(estimatedHours) || estimatedHours <= 0) return 1;
  return Math.max(1, Math.ceil(estimatedHours / (averageCrewSize * crewHoursPerPersonDay)));
}

function addWorkDays(date: Date, daysToAdd: number) {
  const next = new Date(date);
  let added = 0;
  while (added < daysToAdd) {
    next.setDate(next.getDate() + 1);
    const day = next.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return next;
}

function scheduledWorkDays(job: Job) {
  const start = jobStart(job);
  const end = jobEnd(job);
  if (!start || !end) return estimatedWorkDays(job);
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  let days = 0;
  while (cursor <= last && days < 60) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(1, days || estimatedWorkDays(job));
}

function scheduledWorkDates(job: Job) {
  const start = jobStart(job);
  const end = jobEnd(job) || start;
  if (!start || !end) return [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  const dates: string[] = [];
  while (cursor <= last && dates.length < 60) {
    if (!weekend(cursor)) dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates.length ? dates : [dateKey(start)];
}

function scheduleDatesFromDuration(startDateValue: string, durationDays: string | number) {
  const safeDuration = Math.max(1, Math.min(30, Number.parseInt(String(durationDays), 10) || 1));
  const startDate = localDateFromKey(startDateValue);
  const endDate = addWorkDays(startDate, safeDuration - 1);
  return {
    scheduledStartAt: fromScheduleDate(dateKey(startDate)),
    scheduledEndAt: fromScheduleDate(dateKey(endDate), true),
  };
}

function scheduleRange(job: Job) {
  const start = jobStart(job);
  if (!start) return 'Date scheduled';
  const end = jobEnd(job);
  const startText = formatDate(start);
  if (!end || dateKey(start) === dateKey(end)) return startText;
  return `${startText} - ${formatDate(end)}`;
}

function jobAddress(job: Job) {
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

function jobZip(job: Job) {
  return String(job.postalCode || job.leadPostalCode || '').match(/\d{5}/)?.[0] || '';
}

function jobOptionLabel(job: Job) {
  const address = jobAddress(job);
  const name = [job.jobNumber, job.name || 'Job'].filter(Boolean).join(' - ');
  return address ? `${name} - ${address}` : name;
}

function weekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function jobWorkDayInfo(job: Job, day: Date) {
  const workDates = scheduledWorkDates(job);
  const index = workDates.indexOf(dateKey(day));
  return {
    dayNumber: index >= 0 ? index + 1 : null,
    totalDays: workDates.length || 1,
    isFirst: index === 0,
    isLast: index === workDates.length - 1,
  };
}

function weatherMeta(code?: number | null) {
  if (code === 0) return { icon: '☀️', label: 'Sunny' };
  if ([1, 2].includes(Number(code))) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if ([45, 48].includes(Number(code))) return { icon: '🌫️', label: 'Fog' };
  if ([51, 53, 55, 56, 57].includes(Number(code))) return { icon: '🌦️', label: 'Drizzle' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(Number(code))) return { icon: '🌧️', label: 'Rain' };
  if ([71, 73, 75, 77, 85, 86].includes(Number(code))) return { icon: '❄️', label: 'Snow' };
  if ([95, 96, 99].includes(Number(code))) return { icon: '⛈️', label: 'Storms' };
  return { icon: '🌡️', label: 'Forecast' };
}

function weatherForDay(forecast: WeatherForecast | null | undefined, day: Date | string) {
  const key = typeof day === 'string' ? day : dateKey(day);
  return forecast?.days.find((entry) => entry.date === key) || null;
}

function weatherConcerns(day?: WeatherDay | null) {
  if (!day) return [];
  const concerns: string[] = [];
  if (numberValue(day.precipProbability) >= 45 || numberValue(day.precipAmount) >= 0.05) concerns.push('Rain risk');
  if (numberValue(day.windGust) >= 25) concerns.push('Wind');
  if (numberValue(day.low) > 0 && numberValue(day.low) < 50) concerns.push('Cold start');
  if (numberValue(day.high) >= 90) concerns.push('Heat');
  return concerns;
}

function googleWeatherHref(zipCode?: string) {
  return `https://www.google.com/search?${new URLSearchParams({ q: `weather ${zipCode || ''}` })}`;
}

export function Calendar() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedCalendar, setHasLoadedCalendar] = useState(false);
  const [error, setError] = useState('');
  const [quickSchedule, setQuickSchedule] = useState<QuickScheduleState | null>(null);
  const [backlogDrafts, setBacklogDrafts] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const [dropTargetDay, setDropTargetDay] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const [weatherZip, setWeatherZip] = useState('');
  const [weatherZipInput, setWeatherZipInput] = useState('');
  const [businessWeatherZip, setBusinessWeatherZip] = useState('');
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecast | null>(null);
  const [jobForecasts, setJobForecasts] = useState<WeatherForecast[]>([]);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = weekDays[6];
  const monthStart = useMemo(() => getMonthStart(weekStart), [weekStart]);
  const monthGridStart = useMemo(() => getWeekStart(monthStart), [monthStart]);
  const monthDays = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index)), [monthGridStart]);
  const visibleDays = viewMode === 'month' ? monthDays : weekDays;
  const visibleEnd = visibleDays[visibleDays.length - 1];
  const statsDays = useMemo(
    () => viewMode === 'month' ? monthDays.filter((day) => day.getMonth() === monthStart.getMonth()) : weekDays,
    [monthDays, monthStart, viewMode, weekDays],
  );

  const actualHoursByJob = useMemo(() => timeEntries.reduce((totals, entry) => {
    if (!entry.jobId) return totals;
    totals.set(entry.jobId, (totals.get(entry.jobId) || 0) + numberValue(entry.hours));
    return totals;
  }, new Map<string, number>()), [timeEntries]);

  const unscheduledJobs = useMemo(() => jobs
    .filter((job) => activeJob(job) && !jobHasSchedule(job))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))), [jobs]);

  const stats = useMemo(() => {
    const active = jobs.filter(activeJob);
    const scheduledCount = active.filter((job) => jobHasSchedule(job) && statsDays.some((day) => jobIntersectsDay(job, day))).length;
    return {
      scheduled: scheduledCount,
      needsDate: active.filter((job) => !jobHasSchedule(job)).length,
      inProgress: active.filter((job) => job.status === 'in_progress').length,
    };
  }, [jobs, statsDays]);

  async function loadCalendar() {
    setIsLoading(true);
    setError('');
    const timeMin = visibleDays[0].toISOString();
    const timeMax = addDays(visibleEnd, 1).toISOString();
    try {
      const [eventsPayload, jobsPayload, timePayload] = await Promise.all([
        apiJson<{ data?: { google?: GoogleEvent[] } }>(`/v1/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`).catch(() => ({ data: { google: [] } })),
        apiJson<{ data: Job[] }>('/v1/jobs'),
        apiJson<{ data: TimeEntry[] }>('/v1/team/time').catch(() => ({ data: [] })),
      ]);
      setGoogleEvents(eventsPayload.data?.google || []);
      const loadedJobs = jobsPayload.data || [];
      setJobs(loadedJobs);
      setTimeEntries(timePayload.data || []);
      void loadWeather(loadedJobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    } finally {
      setHasLoadedCalendar(true);
      setIsLoading(false);
    }
  }

  async function loadWeather(sourceJobs = jobs, overrideZip?: string) {
    const zips = Array.from(new Set(sourceJobs.map(jobZip).filter(Boolean))).slice(0, 8);
    const params = new URLSearchParams();
    if (overrideZip) params.set('zip', overrideZip);
    if (zips.length) params.set('jobZips', zips.join(','));
    setIsWeatherLoading(true);
    setWeatherError('');
    try {
      const payload = await apiJson<CalendarWeatherResponse>(`/v1/calendar/weather${params.toString() ? `?${params}` : ''}`);
      const data = payload.data || {};
      const resolvedZip = data.zipCode || overrideZip || weatherZipInput || '';
      setWeatherZip(resolvedZip);
      setWeatherZipInput(resolvedZip);
      setBusinessWeatherZip(data.businessZip || '');
      setWeatherForecast(data.forecast || null);
      setJobForecasts(data.jobForecasts || []);
      if (!data.forecast && resolvedZip) setWeatherError(`Weather is unavailable for ${resolvedZip}.`);
    } catch (err) {
      setWeatherForecast(null);
      setJobForecasts([]);
      setWeatherError(err instanceof Error ? err.message : 'Failed to load weather');
    } finally {
      setIsWeatherLoading(false);
    }
  }

  useEffect(() => {
    loadCalendar();
  }, [weekStart.getTime(), viewMode]);

  async function patchJob(jobId: string, body: Partial<Job>, successMessage: string) {
    setSavingJobId(jobId);
    try {
      const response = await apiJson<{ data?: Job }>(`/v1/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setQuickSchedule(null);
      setBacklogDrafts((current) => {
        if (!(jobId in current)) return current;
        const next = { ...current };
        delete next[jobId];
        return next;
      });
      setJobs((current) => current.map((job) => job.id === jobId ? { ...job, ...body, ...(response.data || {}) } : job));
      window.showToast?.(successMessage, 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update schedule', 'error');
    } finally {
      setSavingJobId(null);
    }
  }

  async function scheduleJob(jobId: string, scheduledStartAt: string, scheduledEndAt: string, message = 'Job scheduled.') {
    if (new Date(scheduledEndAt) < new Date(scheduledStartAt)) {
      window.showToast?.('Last work day must be on or after the first work day.', 'error');
      return;
    }
    await patchJob(jobId, { scheduledStartAt, scheduledEndAt, status: 'scheduled' }, message);
  }

  async function scheduleFromDuration(jobId: string, startDay: string, durationDays: string | number) {
    const job = jobs.find((item) => item.id === jobId);
    const dates = scheduleDatesFromDuration(startDay, durationDays);
    await scheduleJob(jobId, dates.scheduledStartAt, dates.scheduledEndAt, `${job?.name || 'Job'} added to the calendar.`);
  }

  async function scheduleDroppedJob(jobId: string, dayKeyValue: string) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    const duration = jobHasSchedule(job) ? scheduledWorkDays(job) : estimatedWorkDays(job);
    const dates = scheduleDatesFromDuration(dayKeyValue, duration);
    const message = jobHasSchedule(job) ? `${job.name || 'Job'} moved on the calendar.` : `${job.name || 'Job'} added to the calendar.`;
    await scheduleJob(job.id, dates.scheduledStartAt, dates.scheduledEndAt, message);
  }

  async function unscheduleJob(job: Job) {
    if (!window.confirm(`Remove ${job.name || 'this job'} from the calendar? It will move back to Needs scheduling.`)) return;
    await patchJob(job.id, { scheduledStartAt: null, scheduledEndAt: null }, `${job.name || 'Job'} moved back to Needs scheduling.`);
  }

  function connectGoogle() {
    window.location.href = `${API_URL}/v1/calendar/connect`;
  }

  async function saveWeatherZip(event: FormEvent) {
    event.preventDefault();
    const zipCode = weatherZipInput.trim().match(/\d{5}/)?.[0] || '';
    if (!zipCode) {
      window.showToast?.('Enter a 5-digit ZIP code', 'error');
      return;
    }
    setIsWeatherLoading(true);
    try {
      await apiJson('/v1/calendar/weather-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ zipCode }),
      });
      await loadWeather(jobs, zipCode);
      window.showToast?.('Calendar weather ZIP saved', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save weather ZIP', 'error');
    } finally {
      setIsWeatherLoading(false);
    }
  }

  function openQuickSchedule(dayKeyValue: string) {
    if (quickSchedule?.dayKey === dayKeyValue) {
      setQuickSchedule(null);
      return;
    }
    const firstJob = unscheduledJobs[0];
    setQuickSchedule({
      dayKey: dayKeyValue,
      jobId: firstJob?.id || '',
      durationDays: String(estimatedWorkDays(firstJob)),
    });
  }

  function handleQuickSchedule(event: FormEvent) {
    event.preventDefault();
    if (!quickSchedule?.jobId) return;
    scheduleFromDuration(quickSchedule.jobId, quickSchedule.dayKey, quickSchedule.durationDays);
  }

  function beginPointerDrag(event: PointerEvent<HTMLElement>, jobId: string) {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    if ((event.target as Element).closest('a, button, input, select, textarea, summary, details, label')) return;
    setDragState({ jobId, startX: event.clientX, startY: event.clientY, active: false });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function movePointerDrag(event: PointerEvent<HTMLElement>) {
    if (!dragState) return;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.active && distance < 10) return;
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const targetDay = element instanceof Element ? element.closest<HTMLElement>('[data-calendar-day]') : null;
    setDragState((current) => current ? { ...current, active: true } : current);
    setDropTargetDay(targetDay?.dataset.calendarDay || null);
  }

  async function endPointerDrag(event: PointerEvent<HTMLElement>) {
    if (!dragState) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const finalDrag = dragState;
    const finalTarget = dropTargetDay;
    setDragState(null);
    setDropTargetDay(null);
    if (!finalDrag.active || !finalTarget) return;
    await scheduleDroppedJob(finalDrag.jobId, finalTarget);
  }

  function shiftCalendar(direction: -1 | 1) {
    setWeekStart((current) => viewMode === 'month'
      ? getWeekStart(addMonths(current, direction))
      : addDays(current, direction * 7));
  }

  function resetCalendar() {
    setWeekStart(getWeekStart(new Date()));
  }

  function calendarTitle() {
    if (viewMode === 'month') {
      return formatDate(monthStart, { month: 'long', year: 'numeric' });
    }
    return `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
  }

  function renderCompactStats() {
    const scheduledLabel = viewMode === 'month' ? 'Scheduled this month' : 'Scheduled this week';
    return (
      <div className="flex flex-wrap gap-2">
        <Stat label={scheduledLabel} value={stats.scheduled} />
        <Stat label="Needs date" value={stats.needsDate} />
        <Stat label="In progress" value={stats.inProgress} />
      </div>
    );
  }

  const isInitialCalendarLoading = isLoading && !hasLoadedCalendar;
  const isRefreshingCalendar = isLoading && hasLoadedCalendar;

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <p className="pf-copy max-w-2xl">
            Put accepted jobs on the production calendar, spot jobs missing dates, and keep Google Calendar as an optional external sync.
          </p>
          <div className="mt-3">{renderCompactStats()}</div>
        </div>
        <div className="lg:justify-self-end">
          <div className="pf-segmented-group" aria-label="Calendar view">
            <button type="button" aria-pressed={viewMode === 'week'} onClick={() => setViewMode('week')}>Week</button>
            <button type="button" aria-pressed={viewMode === 'month'} onClick={() => setViewMode('month')}>Month</button>
          </div>
        </div>
      </div>

      <UpsellCard
        eyebrow="Calendar sync"
        title="Connect Google Calendar"
        body="Keep production dates visible outside PaintFlow and reduce missed schedule updates as the crew calendar changes."
        ctaText="Connect Google"
        icon="calendar"
        tone="neutral"
        compact
        className="mb-5"
        onCta={connectGoogle}
      />

      {renderWeatherPanel()}

      <Card className="sticky top-[4.4rem] z-20 mb-5 bg-white/95 backdrop-blur lg:ml-auto lg:max-w-md" padding="sm">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <button
            type="button"
            className="btn-icon btn-icon-outlined"
            aria-label={viewMode === 'month' ? 'Previous month' : 'Previous week'}
            onClick={() => shiftCalendar(-1)}
          >
            <Icon name="chevron-left" className="h-4 w-4" />
          </button>
          <div className="min-w-0 text-center">
            <p className="pf-emphasis truncate">{calendarTitle()}</p>
            <button type="button" className="mt-1 text-sm font-medium text-blue-700 hover:text-blue-800" onClick={resetCalendar}>
              Today
            </button>
          </div>
          <button
            type="button"
            className="btn-icon btn-icon-outlined"
            aria-label={viewMode === 'month' ? 'Next month' : 'Next week'}
            onClick={() => shiftCalendar(1)}
          >
            <Icon name="chevron-right" className="h-4 w-4" />
          </button>
        </div>
      </Card>

      {error && (
        <div className="mb-5">
          <ServiceErrorState error={error} pageName="Calendar" title="Calendar schedule is unavailable" onRetry={loadCalendar} compact />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-8" padding="none">
          <div className="flex flex-col gap-2 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="pf-section-title">Production schedule</h2>
              <p className="pf-helper">
                {viewMode === 'month'
                  ? 'Month view gives owners a wider production picture. Switch to week for fuller job detail.'
                  : 'Jobs render on every scheduled work day they span.'}
              </p>
            </div>
            <Button as="a" href="/jobs" variant="ghost" size="sm">Open jobs</Button>
          </div>
          <CardContent className="relative p-3 sm:p-4">
            {isInitialCalendarLoading ? (
              <div className="py-12 text-center">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
                <p className="pf-copy mt-4">Loading calendar...</p>
              </div>
            ) : (
              <>
                <div className={isRefreshingCalendar ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
                  {viewMode === 'month' ? renderMonthGrid() : renderWeekGrid()}
                </div>
                {isRefreshingCalendar && (
                  <div className="absolute inset-0 z-10 flex items-start justify-center rounded-b-lg bg-white/55 pt-6 backdrop-blur-[1px]" aria-live="polite" aria-label="Refreshing calendar">
                    <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                      Updating calendar
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4" padding="none">
          <CardHeader className="border-b border-gray-200 px-4 py-3" title="Needs scheduling" description="Active jobs without production dates." />
          <CardContent className="relative grid gap-3 p-3 sm:p-4">
            {isInitialCalendarLoading ? (
              <p className="pf-copy py-8 text-center">Loading jobs...</p>
            ) : unscheduledJobs.length ? (
              unscheduledJobs.map((job) => renderBacklogJob(job))
            ) : (
              <div className="py-8 text-center">
                <p className="pf-emphasis">Everything active has a date.</p>
                <p className="pf-copy mt-1">New accepted jobs without dates will appear here.</p>
              </div>
            )}
            {isRefreshingCalendar && (
              <div className="absolute inset-0 rounded-b-lg bg-white/45 backdrop-blur-[1px]" aria-hidden="true" />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );

  function renderWeekGrid() {
    return (
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))] max-sm:grid-cols-1">
        {weekDays.map((day) => renderDay(day))}
      </div>
    );
  }

  function renderMonthGrid() {
    return (
      <div>
        <div className="mb-2 hidden grid-cols-7 gap-2 px-1 text-center sm:grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
            <p key={label} className="pf-meta">{label}</p>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-7">
          {monthDays.map((day) => renderDay(day, true))}
        </div>
      </div>
    );
  }

  function renderDay(day: Date, compact = false) {
    const key = dateKey(day);
    const today = key === dateKey(new Date());
    const inCurrentMonth = day.getMonth() === monthStart.getMonth();
    const dayEvents = googleEvents.filter((event) => {
      const start = event.start?.dateTime || event.start?.date;
      return start && dateKey(start) === key;
    });
    const dayJobs = jobs
      .filter((job) => activeJob(job) && jobIntersectsDay(job, day))
      .sort((a, b) => String(a.scheduledStartAt || '').localeCompare(String(b.scheduledStartAt || '')));
    const empty = !dayEvents.length && !dayJobs.length;
    const dayWeather = weatherForDay(weatherForecast, day);
    const weather = weatherMeta(dayWeather?.weatherCode);
    const concerns = weatherConcerns(dayWeather);
    if (compact) {
      return (
        <section
          key={key}
          data-calendar-day={key}
          className={`flex min-h-36 flex-col rounded-lg border bg-white p-2 transition-colors sm:min-h-44 ${inCurrentMonth ? '' : 'opacity-55'} ${today ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'} ${dropTargetDay === key ? 'border-blue-500 bg-blue-50 shadow-inner' : ''}`}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types || []).includes('text/plain')) return;
            event.preventDefault();
            setDropTargetDay(key);
          }}
          onDragLeave={() => setDropTargetDay(null)}
          onDrop={(event) => {
            event.preventDefault();
            const jobId = event.dataTransfer.getData('application/x-paintflow-job-id') || event.dataTransfer.getData('text/plain');
            setDropTargetDay(null);
            if (jobId) scheduleDroppedJob(jobId, key);
          }}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="pf-emphasis text-sm sm:hidden">{formatDate(day, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
              <p className="hidden text-sm font-semibold text-gray-950 sm:block">{day.getDate()}</p>
              {dayWeather && (
                <a
                  href={googleWeatherHref(weatherZip)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 rounded-full bg-gray-50 px-1.5 py-0.5 text-[0.68rem] font-medium text-gray-700 hover:text-blue-700"
                  title={weather.label}
                >
                  <span aria-hidden="true">{weather.icon}</span>
                  <span>{Math.round(numberValue(dayWeather.high))}°</span>
                  <span>{numberValue(dayWeather.precipProbability)}%</span>
                </a>
              )}
              {concerns.length > 0 && (
                <div>
                  <Badge variant="warning" size="sm">{concerns[0]}</Badge>
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              {today && <Badge variant="info" size="sm">Today</Badge>}
            </div>
          </div>
          <div className="grid gap-1.5">
            {dayJobs.slice(0, 3).map((job) => renderMonthJobChip(job, day))}
            {dayJobs.length > 3 && <p className="pf-meta">+{dayJobs.length - 3} more</p>}
            {dayEvents.length > 0 && <p className="rounded bg-gray-100 px-2 py-1 text-[0.68rem] font-medium text-gray-600">{dayEvents.length} Google event{dayEvents.length === 1 ? '' : 's'}</p>}
            {!dayJobs.length && !dayEvents.length && <p className="pf-helper text-center sm:mt-2">Open</p>}
          </div>
          {quickSchedule?.dayKey === key && renderQuickSchedule(key)}
          <div className="mt-auto flex justify-end pt-2">
            <button type="button" className="px-1 text-[0.7rem] font-semibold text-blue-700 hover:underline" onClick={() => openQuickSchedule(key)}>
              + Add
            </button>
          </div>
        </section>
      );
    }

    return (
      <section
        key={key}
        data-calendar-day={key}
        className={`flex min-h-40 flex-col rounded-lg border bg-white p-3 transition-colors ${today ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'} ${dropTargetDay === key ? 'border-blue-500 bg-blue-50 shadow-inner' : ''}`}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types || []).includes('text/plain')) return;
          event.preventDefault();
          setDropTargetDay(key);
        }}
        onDragLeave={() => setDropTargetDay(null)}
        onDrop={(event) => {
          event.preventDefault();
          const jobId = event.dataTransfer.getData('application/x-paintflow-job-id') || event.dataTransfer.getData('text/plain');
          setDropTargetDay(null);
          if (jobId) scheduleDroppedJob(jobId, key);
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="pf-emphasis text-sm">{formatDate(day, { weekday: 'short' })}</p>
            <p className="pf-helper">{formatDate(day)}</p>
            {dayWeather && (
              <a
                href={googleWeatherHref(weatherZip)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:text-blue-700"
              >
                <span aria-hidden="true">{weather.icon}</span>
                <span>{Math.round(numberValue(dayWeather.high))}°/{Math.round(numberValue(dayWeather.low))}°</span>
                <span>{numberValue(dayWeather.precipProbability)}%</span>
              </a>
            )}
          </div>
          <div className="flex gap-1">
            {weekend(day) && <Badge size="sm">Weekend</Badge>}
            {today && <Badge variant="info" size="sm">Today</Badge>}
            {concerns.length > 0 && <Badge variant="warning" size="sm">{concerns[0]}</Badge>}
          </div>
        </div>
        <div className="grid gap-2">
          {dayJobs.map((job) => renderJobCard(job, day))}
          {dayEvents.map((event) => (
            <div key={event.id || event.summary} className="rounded-lg bg-gray-100 p-2 text-xs text-gray-700">
              <p className="pf-emphasis">{event.summary || 'Google event'}</p>
              <p className="pf-helper">{formatTime(event.start?.dateTime || event.start?.date)}</p>
            </div>
          ))}
          {empty && <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center pf-helper">No scheduled work</div>}
        </div>
        {quickSchedule?.dayKey === key && renderQuickSchedule(key)}
        <div className="mt-auto flex justify-end pt-3">
          <button type="button" className="px-1 text-xs font-semibold text-blue-700 hover:underline" onClick={() => openQuickSchedule(key)}>
            + Add job
          </button>
        </div>
      </section>
    );
  }

  function renderMonthJobChip(job: Job, day: Date) {
    const dayInfo = jobWorkDayInfo(job, day);
    const siteForecast = jobForecasts.find((forecast) => forecast.zipCode === jobZip(job));
    const siteConcerns = weatherConcerns(weatherForDay(siteForecast, day));
    return (
      <Link
        key={job.id}
        to={`/jobs/${job.id}`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', job.id);
          event.dataTransfer.setData('application/x-paintflow-job-id', job.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        className={`min-w-0 rounded-md px-2 py-1 text-[0.72rem] font-semibold leading-snug text-blue-950 hover:bg-blue-100 ${siteConcerns.length ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-blue-50'}`}
        title={siteConcerns.length ? `${job.name || 'Job'} - ${siteConcerns.join(', ')}` : job.name || 'Job'}
      >
        <span className="block truncate">{job.name || 'Job'}</span>
        {dayInfo.totalDays > 1 && dayInfo.dayNumber && (
          <span className="mt-0.5 block text-[0.65rem] font-medium text-blue-700">Day {dayInfo.dayNumber}/{dayInfo.totalDays}</span>
        )}
      </Link>
    );
  }

  function renderJobCard(job: Job, day: Date) {
    const address = jobAddress(job);
    const dayInfo = jobWorkDayInfo(job, day);
    const actualHours = actualHoursByJob.get(job.id) || 0;
    const estimatedHours = numberValue(job.estimatedLaborHours);
    const remainingHours = Math.max(0, estimatedHours - actualHours);
    const progress = estimatedHours > 0 ? Math.min(100, (actualHours / estimatedHours) * 100) : 0;
    const canUnschedule = job.status === 'scheduled';
    const siteForecast = jobForecasts.find((forecast) => forecast.zipCode === jobZip(job));
    const siteWeather = weatherForDay(siteForecast, day);
    const siteConcerns = weatherConcerns(siteWeather);
    return (
      <article
        key={job.id}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', job.id);
          event.dataTransfer.setData('application/x-paintflow-job-id', job.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onPointerDown={(event) => beginPointerDrag(event, job.id)}
        onPointerMove={movePointerDrag}
        onPointerUp={endPointerDrag}
        onPointerCancel={() => {
          setDragState(null);
          setDropTargetDay(null);
        }}
        className={`min-w-0 overflow-hidden border border-blue-100 bg-blue-50/70 p-2.5 shadow-sm transition hover:border-blue-300 hover:shadow ${dayInfo.totalDays > 1 ? 'rounded-lg border-l-4 border-l-blue-500' : 'rounded-xl'} ${!dayInfo.isFirst && dayInfo.totalDays > 1 ? 'border-l-blue-300 bg-blue-50/50' : ''} ${dragState?.jobId === job.id && dragState.active ? 'opacity-70' : ''}`}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <p className="min-w-0 truncate pf-emphasis text-sm">{job.name || 'Job'}</p>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={job.status || 'scheduled'} />
            {dayInfo.totalDays > 1 && dayInfo.dayNumber && (
              <span className="rounded-full bg-white px-2 py-0.5 text-[0.68rem] font-semibold text-blue-800 shadow-sm">
                Day {dayInfo.dayNumber}/{dayInfo.totalDays}
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 truncate pf-helper">
          {dayInfo.totalDays > 1
            ? `${dayInfo.isFirst ? 'Starts' : dayInfo.isLast ? 'Finishes' : 'Continues'} - ${scheduleRange(job)}`
            : scheduleRange(job)}
        </p>
        {address && <p className="mt-1 line-clamp-2 pf-helper">{address}</p>}
        {estimatedHours > 0 ? (
          <div className="mt-2">
            <div className="mb-1 flex justify-between gap-2 pf-helper">
              <span>{actualHours.toFixed(1).replace(/\.0$/, '')}/{estimatedHours.toFixed(1).replace(/\.0$/, '')} hrs</span>
              <span>{remainingHours.toFixed(1).replace(/\.0$/, '')} remaining</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <p className="mt-2 pf-helper">No labor estimate</p>
        )}
        {siteConcerns.length > 0 && (
          <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
            {siteConcerns.join(', ')} at job site{jobZip(job) ? ` (${jobZip(job)})` : ''}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link to={`/jobs/${job.id}`} className="text-xs font-semibold text-blue-700 hover:underline">Open job</Link>
          {canUnschedule && (
            <button type="button" className="text-xs font-semibold text-gray-600 hover:text-red-700" disabled={savingJobId === job.id} onClick={() => unscheduleJob(job)}>
              Unschedule
            </button>
          )}
        </div>
      </article>
    );
  }

  function renderWeatherPanel() {
    const days = weatherForecast?.days || [];
    const fallbackZip = weatherZip || weatherZipInput || businessWeatherZip;
    return (
      <Card className="mb-5" padding="sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="pf-section-title">10-day weather</h2>
            <p className="pf-copy mt-1">Job-site weather risks appear on scheduled work days when forecast data is available.</p>
          </div>
          <form className="flex gap-2 sm:w-72" noValidate onSubmit={saveWeatherZip}>
            <input
              className="input"
              type="text"
              autoComplete="postal-code"
              inputMode="numeric"
              maxLength={5}
              aria-label="Calendar weather ZIP"
              placeholder="ZIP"
              value={weatherZipInput}
              onChange={(event) => setWeatherZipInput(event.target.value.replace(/\D/g, '').slice(0, 5))}
            />
            <Button type="submit" variant="secondary" size="sm" isLoading={isWeatherLoading}>
              Save
            </Button>
          </form>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="pf-meta">
            {weatherForecast ? `${weatherForecast.label || weatherForecast.zipCode} weather` : weatherError || 'Add a ZIP code to show weather.'}
          </p>
          {(fallbackZip || weatherError) && (
            <a className="text-sm font-semibold text-blue-700 hover:underline" href={googleWeatherHref(fallbackZip)} target="_blank" rel="noreferrer">
              Google Weather
            </a>
          )}
        </div>
        {isWeatherLoading && !days.length ? (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-gray-100" />)}
          </div>
        ) : days.length ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {days.map((day) => {
              const meta = weatherMeta(day.weatherCode);
              const concerns = weatherConcerns(day);
              return (
                <a
                  key={day.date}
                  href={googleWeatherHref(weatherZip)}
                  target="_blank"
                  rel="noreferrer"
                  className={`min-w-24 rounded-lg border p-2 text-center hover:border-blue-300 ${concerns.length ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}
                  title={meta.label}
                >
                  <p className="pf-meta">{formatDate(day.date, { weekday: 'short' })}</p>
                  <p className="mt-1 text-xl" aria-label={meta.label}>{meta.icon}</p>
                  <p className="pf-meta mt-0.5 truncate">{meta.label}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-950">{Math.round(numberValue(day.high))}°/{Math.round(numberValue(day.low))}°</p>
                  <p className="pf-meta mt-1">{numberValue(day.precipProbability)}% precip</p>
                </a>
              );
            })}
          </div>
        ) : null}
      </Card>
    );
  }

  function renderQuickSchedule(dayKeyValue: string) {
    if (!unscheduledJobs.length) {
      return (
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="pf-emphasis">No unscheduled jobs right now.</p>
          <p className="pf-helper mt-1">Use Unschedule on a scheduled job card to move it back into Needs scheduling and try the flow.</p>
        </div>
      );
    }
    return (
      <form className="mt-3 grid gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3" onSubmit={handleQuickSchedule}>
        <label>
          <span className="form-label">Job</span>
          <select
            className="input"
            value={quickSchedule?.jobId || ''}
            onChange={(event) => {
              const job = jobs.find((item) => item.id === event.target.value);
              setQuickSchedule({ dayKey: dayKeyValue, jobId: event.target.value, durationDays: String(estimatedWorkDays(job)) });
            }}
            required
          >
            {unscheduledJobs.map((job) => <option key={job.id} value={job.id}>{jobOptionLabel(job)}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <label>
            <span className="form-label">Work days</span>
            <input
              className="input"
              type="number"
              min="1"
              max="30"
              step="1"
              value={quickSchedule?.durationDays || '1'}
              onChange={(event) => setQuickSchedule((current) => current ? { ...current, durationDays: event.target.value } : current)}
              required
            />
          </label>
          <Button size="sm" type="submit" isLoading={Boolean(savingJobId && savingJobId === quickSchedule?.jobId)}>
            Add
          </Button>
        </div>
      </form>
    );
  }

  function renderBacklogJob(job: Job) {
    const address = jobAddress(job);
    const estimateHours = numberValue(job.estimatedLaborHours);
    const workDays = estimatedWorkDays(job);
    const durationCopy = estimateHours > 0
      ? `${estimateHours.toFixed(1).replace(/\.0$/, '')} estimated crew-hours. Defaults to ${workDays} work day${workDays === 1 ? '' : 's'} at a ${averageCrewSize}-person crew.`
      : 'No labor-hour estimate found. Defaults to 1 work day.';
    const draft = backlogDrafts[job.id] || { startDate: '', endDate: '' };

    function submitSchedule(event: FormEvent) {
      event.preventDefault();
      if (!draft.startDate) return;
      const finalEnd = draft.endDate || dateKey(addWorkDays(localDateFromKey(draft.startDate), workDays - 1));
      scheduleJob(job.id, fromScheduleDate(draft.startDate), fromScheduleDate(finalEnd, true));
    }

    return (
      <BacklogJobCard
        key={job.id}
        job={job}
        address={address}
        durationCopy={durationCopy}
        startDate={draft.startDate}
        endDate={draft.endDate}
        isSaving={savingJobId === job.id}
        onStartDate={(value) => {
          setBacklogDrafts((current) => ({
            ...current,
            [job.id]: {
              startDate: value,
              endDate: current[job.id]?.endDate || (value ? dateKey(addWorkDays(localDateFromKey(value), workDays - 1)) : ''),
            },
          }));
        }}
        onEndDate={(value) => setBacklogDrafts((current) => ({
          ...current,
          [job.id]: { startDate: current[job.id]?.startDate || '', endDate: value },
        }))}
        onSubmit={submitSchedule}
        onPointerDown={beginPointerDrag}
        onPointerMove={movePointerDrag}
        onPointerUp={endPointerDrag}
        onPointerCancel={() => {
          setDragState(null);
          setDropTargetDay(null);
        }}
        dragging={dragState?.jobId === job.id && dragState.active}
      />
    );
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 shadow-sm">
      <span className="text-sm font-semibold text-gray-950">{value}</span>
      <span className="pf-meta whitespace-nowrap">{label}</span>
    </div>
  );
}

interface BacklogJobCardProps {
  job: Job;
  address: string;
  durationCopy: string;
  startDate: string;
  endDate: string;
  isSaving: boolean;
  dragging?: boolean;
  onStartDate: (value: string) => void;
  onEndDate: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, jobId: string) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

function BacklogJobCard({
  job,
  address,
  durationCopy,
  startDate,
  endDate,
  isSaving,
  dragging = false,
  onStartDate,
  onEndDate,
  onSubmit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: BacklogJobCardProps) {
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', job.id);
        event.dataTransfer.setData('application/x-paintflow-job-id', job.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onPointerDown={(event) => onPointerDown(event, job.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`rounded-lg border border-gray-200 bg-white p-3 transition hover:border-blue-200 hover:shadow-sm ${dragging ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate pf-emphasis">{job.name || 'Job'}</p>
          <p className="mt-1 pf-helper">
            {labelize(job.status) || 'Ready to schedule'}{job.budget ? ` - ${formatMoney(job.budget)}` : ''}
          </p>
          {address && <p className="mt-1 pf-helper">{address}</p>}
          <Link to={`/jobs/${job.id}`} className="mt-2 inline-flex text-xs font-semibold text-blue-700 hover:underline">Open job</Link>
        </div>
      </div>
      <details className="mt-3">
        <summary className="inline-flex cursor-pointer select-none rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
          Set dates
        </summary>
        <form className="mt-3 grid gap-2" onSubmit={onSubmit}>
          <p className="rounded-lg bg-gray-50 px-3 py-2 pf-helper">{durationCopy}</p>
          <label>
            <span className="form-label">First work day</span>
            <input type="date" className="input" value={startDate} onChange={(event) => onStartDate(event.target.value)} required />
          </label>
          <label>
            <span className="form-label">Last work day <span className="font-normal text-gray-500">(auto-filled)</span></span>
            <input type="date" className="input" value={endDate} onChange={(event) => onEndDate(event.target.value)} />
          </label>
          <Button size="sm" type="submit" isLoading={isSaving}>Schedule job</Button>
        </form>
      </details>
    </article>
  );
}
