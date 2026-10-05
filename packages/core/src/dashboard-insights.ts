export type DashboardWeeks = 4 | 8 | 12;

export interface DashboardRange {
  weeks: DashboardWeeks;
  timeZone: string;
  startDate: string;
  endDate: string;
  asOf: string;
}

export interface DashboardInsights {
  range: DashboardRange;
  weeklyLeads: Array<{ weekStart: string; count: number; current: boolean }>;
  funnel: {
    leads: number;
    estimated: number;
    sent: number;
    won: number;
    lost: number;
    open: number;
    manualWins: number;
    winRate: number | null;
    estimateRate: number | null;
    sendRate: number | null;
    approvalRate: number | null;
  };
  operations: Record<'depositPending' | 'needsScheduling' | 'scheduled' | 'inProduction' | 'punchList' | 'completed', number>;
}

const DAY = 86_400_000;

export function dashboardRange(weeks: DashboardWeeks, timeZone: string, now = new Date()): DashboardRange {
  if (![4, 8, 12].includes(weeks)) throw new Error('Choose 4, 8, or 12 weeks.');
  // Calendar dates are in the viewer's timezone; the database stores UTC instants.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const day = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const monday = day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY;
  const date = (value: number) => new Date(value).toISOString().slice(0, 10);
  return { weeks, timeZone, startDate: date(monday - (weeks - 1) * 7 * DAY), endDate: date(day.getTime()), asOf: now.toISOString() };
}

export function dashboardPercent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round(numerator / denominator * 1000) / 10 : null;
}

export function dashboardInsights(range: DashboardRange, row: Record<string, unknown>): DashboardInsights {
  const count = (key: string) => Number(row[key] ?? 0);
  const leadCount = count('leads');
  const estimated = count('estimated');
  const sent = count('sent');
  const won = count('won');
  const lost = count('lost');
  const manualWins = count('manualWins');
  const weekly = (row.weeklyLeads ?? []) as Array<{ weekStart: string; count: number | string }>;
  return {
    range,
    weeklyLeads: weekly.map((week, index) => ({ weekStart: week.weekStart, count: Number(week.count), current: index === range.weeks - 1 })),
    funnel: {
      leads: leadCount, estimated, sent, won, lost, open: leadCount - won - lost - manualWins, manualWins,
      winRate: dashboardPercent(won, leadCount), estimateRate: dashboardPercent(estimated, leadCount),
      sendRate: dashboardPercent(sent, estimated), approvalRate: dashboardPercent(won, sent),
    },
    operations: {
      depositPending: count('depositPending'), needsScheduling: count('needsScheduling'), scheduled: count('scheduled'),
      inProduction: count('inProduction'), punchList: count('punchList'), completed: count('completed'),
    },
  };
}
