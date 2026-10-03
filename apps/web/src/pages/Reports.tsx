import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardContent, CardHeader } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { apiJson, formatMoney, labelize } from "@/lib/api";

interface DashboardReport {
  asOf: string;
  totalLeads: number;
  wonLeads: number;
  winRate: number;
  contractedSubtotal: number | null;
  recordedActualCost: number;
  approvedActualCost: number | null;
  currentCostPosition: number | null;
  margin: number | null;
  collectedGross: number;
  refundedGross: number | null;
  netCollectedGross: number | null;
  costCompleteness: "unknown" | "incomplete";
  warnings: Array<{ code: string; message: string; action: string }>;
}

interface WinRateRow {
  source: string;
  total: number;
  won: number;
  winRate: number;
}
interface CrewRow {
  memberId: string;
  name: string;
  totalHours: number | string;
  jobsWorked: number | string;
  totalCost: number | string;
}
interface MarginRow {
  jobId: string;
  title: string;
  status: string;
  revenue: number | null;
  costs: number;
  profit: number | null;
  margin: number | null;
  costCompleteness: "unknown" | "incomplete";
  unreviewedTimeCount: number;
  contractNeedsReview: boolean;
}
interface JobMix {
  cities: Array<{
    label: string;
    jobs: number;
    contractedSubtotal: number | null;
    knownContractedSubtotal: number;
    unresolvedJobs: number;
  }>;
  statuses: Array<{ status: string; count: number }>;
}
interface ReportsState {
  dashboard: DashboardReport | null;
  winRate: WinRateRow[] | null;
  crew: CrewRow[] | null;
  margins: MarginRow[] | null;
  mix: JobMix | null;
}
type ReportKey = keyof ReportsState;
const reportRoutes: Record<ReportKey, string> = {
  dashboard: "/v1/reports/dashboard",
  winRate: "/v1/reports/win-rate-by-source",
  crew: "/v1/reports/crew-performance",
  margins: "/v1/reports/profit-margins?limit=20",
  mix: "/v1/reports/job-mix",
};
const reportKeys = Object.keys(reportRoutes) as ReportKey[];

function numeric(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}
function numberText(value: unknown) {
  return numeric(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function moneyText(value: number | string | null | undefined) {
  return value == null ? "Not available" : formatMoney(value);
}
function percentText(value: number | null | undefined) {
  return value == null
    ? "Not available"
    : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
function barWidth(value: number, max: number) {
  return `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%`;
}
function marginTone(value: number | null) {
  return value === null
    ? "text-[var(--pf-text-muted)]"
    : value >= 30
      ? "text-[var(--pf-success)]"
      : value >= 15
        ? "text-[var(--pf-warning)]"
        : "text-[var(--pf-danger)]";
}

function Summary({
  label,
  value,
  help,
  icon,
}: {
  label: string;
  value: string;
  help: string;
  icon: string;
}) {
  return (
    <div className="min-w-0 border-b border-[var(--pf-border)] py-3 sm:rounded-lg sm:border sm:bg-[var(--pf-surface)] sm:p-4">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="pf-meta inline-flex items-center gap-2">
          <Icon name={icon} className="h-4 w-4 shrink-0" />
          {label}
        </p>
        <p className="pf-section-title whitespace-nowrap">{value}</p>
      </div>
      <p className="pf-helper mt-1">{help}</p>
    </div>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading report"
      className="grid gap-3 motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading report</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-14 rounded-md bg-[var(--pf-surface-muted)]"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function SectionState({
  pending,
  error,
  empty,
  retry,
  children,
}: {
  pending: boolean;
  error?: string;
  empty?: string;
  retry: () => void;
  children: React.ReactNode;
}) {
  if (pending) return <Skeleton />;
  if (error)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="pf-copy text-[var(--pf-danger)]">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  if (empty) return <p className="pf-copy py-4">{empty}</p>;
  return <>{children}</>;
}

export function Reports() {
  const [state, setState] = useState<ReportsState>({
    dashboard: null,
    winRate: null,
    crew: null,
    margins: null,
    mix: null,
  });
  const [errors, setErrors] = useState<Partial<Record<ReportKey, string>>>({});
  const [pending, setPending] = useState<Partial<Record<ReportKey, boolean>>>(
    {},
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const inFlight = useRef(new Set<ReportKey>());
  const moreInFlight = useRef(false);

  useEffect(() => {
    reportKeys.forEach((key) => {
      void loadSection(key);
    });
  }, []);

  async function loadSection(key: ReportKey) {
    if (
      inFlight.current.has(key) ||
      (key === "margins" && moreInFlight.current)
    )
      return;
    inFlight.current.add(key);
    setPending((previous) => ({ ...previous, [key]: true }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    try {
      const response = await apiJson<{
        data: ReportsState[ReportKey];
        nextCursor?: string | null;
      }>(reportRoutes[key]);
      if (response.data == null)
        throw new Error("This report returned no data. Please retry.");
      setState((previous) => ({ ...previous, [key]: response.data }));
      if (key === "margins") {
        setNextCursor(response.nextCursor ?? null);
        setMoreError("");
      }
    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        [key]:
          error instanceof Error
            ? error.message
            : "Could not load this report.",
      }));
    } finally {
      inFlight.current.delete(key);
      setPending((previous) => ({ ...previous, [key]: false }));
    }
  }

  async function loadMore() {
    if (!nextCursor || moreInFlight.current || inFlight.current.has("margins"))
      return;
    moreInFlight.current = true;
    setLoadingMore(true);
    setMoreError("");
    try {
      const response = await apiJson<{
        data: MarginRow[];
        nextCursor?: string | null;
      }>(`${reportRoutes.margins}&cursor=${encodeURIComponent(nextCursor)}`);
      if (!Array.isArray(response.data))
        throw new Error("Could not load more jobs. Please retry.");
      setState((previous) => ({
        ...previous,
        margins: [
          ...(previous.margins ?? []),
          ...response.data.filter(
            (row) =>
              !previous.margins?.some(
                (existing) => existing.jobId === row.jobId,
              ),
          ),
        ],
      }));
      setNextCursor(response.nextCursor ?? null);
    } catch (error) {
      setMoreError(
        error instanceof Error ? error.message : "Could not load more jobs.",
      );
    } finally {
      moreInFlight.current = false;
      setLoadingMore(false);
    }
  }

  const dashboard = state.dashboard;
  const sourceRows = state.winRate ?? [];
  const crewRows = state.crew ?? [];
  const margins = state.margins ?? [];
  const cities = state.mix?.cities ?? [];
  const maxCrewHours = Math.max(
    0,
    ...crewRows.map((row) => numeric(row.totalHours)),
  );
  const maxCityValue = Math.max(
    0,
    ...cities.map((row) => row.knownContractedSubtotal),
  );
  const updating = Object.values(pending).some(Boolean);

  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="pf-copy">Sales, cash and recorded job costs.</p>
          {dashboard && (
            <p className="pf-helper mt-1">
              As of{" "}
              {new Date(dashboard.asOf).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          disabled={updating || loadingMore}
          leftIcon={<Icon name="refresh" className="pf-icon" />}
          onClick={() =>
            reportKeys.forEach((key) => {
              void loadSection(key);
            })
          }
        >
          {updating ? "Updating" : "Refresh reports"}
        </Button>
      </header>

      {errors.dashboard && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--pf-danger)] p-4"
        >
          <p className="pf-copy text-[var(--pf-danger)]">
            Financial totals could not be loaded. {errors.dashboard}
          </p>
          <Button variant="secondary" onClick={() => loadSection("dashboard")}>
            Retry totals
          </Button>
        </div>
      )}
      {!dashboard && !errors.dashboard && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} padding="sm">
              <Skeleton rows={2} />
            </Card>
          ))}
        </div>
      )}
      {dashboard && (
        <>
          {dashboard.warnings.length > 0 && (
            <section
              aria-label="Report exceptions"
              className="mb-5 grid gap-3 border-l-2 border-[var(--pf-warning)] pl-3"
            >
              {dashboard.warnings.map((warning) => (
                <div
                  key={warning.code}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <p className="pf-copy min-w-0 flex-1">{warning.message}</p>
                  <Button as="a" href={warning.action} variant="ghost">
                    Review
                  </Button>
                </div>
              ))}
            </section>
          )}
          <div
            className="mb-5 grid grid-cols-1 gap-0 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4"
            aria-busy={!!pending.dashboard}
          >
            <Summary
              label="Contracted work"
              value={moneyText(dashboard.contractedSubtotal)}
              help="Approved scope, before tax"
              icon="briefcase"
            />
            <Summary
              label="Recorded costs"
              value={moneyText(dashboard.recordedActualCost)}
              help={
                dashboard.approvedActualCost === null
                  ? "Labor review pending"
                  : "Captured so far; not final"
              }
              icon="receipt"
            />
            <Summary
              label="Net cash received"
              value={moneyText(dashboard.netCollectedGross)}
              help="Receipts less refunds; includes tax"
              icon="credit-card"
            />
            <Summary
              label="Lead win rate"
              value={percentText(dashboard.winRate)}
              help={`${numberText(dashboard.wonLeads)} of ${numberText(dashboard.totalLeads)} customers won`}
              icon="bar-chart"
            />
          </div>
          <details
            aria-label="Current cost and collection position"
            className="mb-6 border-y border-[var(--pf-border)] py-4"
          >
            <summary className="pf-emphasis min-h-12 cursor-pointer">
              Cost and cash details
            </summary>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="pf-meta">Current cost position</dt>
                <dd className="pf-emphasis mt-1">
                  {moneyText(dashboard.currentCostPosition)}
                </dd>
              </div>
              <div>
                <dt className="pf-meta">Recorded cost margin</dt>
                <dd
                  className={`pf-emphasis mt-1 ${marginTone(dashboard.margin)}`}
                >
                  {percentText(dashboard.margin)}
                </dd>
              </div>
              <div>
                <dt className="pf-meta">Cash receipts</dt>
                <dd className="pf-emphasis mt-1">
                  {moneyText(dashboard.collectedGross)}
                </dd>
              </div>
              <div>
                <dt className="pf-meta">Refunds</dt>
                <dd className="pf-emphasis mt-1">
                  {moneyText(dashboard.refundedGross)}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="warning">
                {dashboard.costCompleteness === "unknown"
                  ? "Costs not captured"
                  : "Cost capture incomplete"}
              </Badge>
              <p className="pf-helper">
                This is not a final margin or accounting profit.
              </p>
            </div>
          </details>
        </>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padding="none">
          <CardHeader
            className="mb-0 border-b border-[var(--pf-border)] px-4 py-3"
            title="Lead sources"
            description="Distinct customers won, not proposal revisions."
          />
          <CardContent className="p-4">
            <SectionState
              pending={!state.winRate && !errors.winRate}
              error={errors.winRate}
              empty={
                state.winRate?.length === 0
                  ? "Add customer sources to compare channels."
                  : undefined
              }
              retry={() => loadSection("winRate")}
            >
              <div className="grid gap-4">
                {sourceRows.map((row) => (
                  <div key={row.source}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="pf-emphasis min-w-0 truncate">
                        {row.source}
                      </p>
                      <p className="pf-emphasis shrink-0">
                        {percentText(row.winRate)}{" "}
                        <span className="pf-helper">
                          ({numberText(row.won)}/{numberText(row.total)})
                        </span>
                      </p>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-2 h-2 rounded-full bg-[var(--pf-surface-muted)]"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--pf-primary)]"
                        style={{ width: barWidth(row.winRate, 100) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SectionState>
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader
            className="mb-0 border-b border-[var(--pf-border)] px-4 py-3"
            title="Crew labor"
            description="Approved time only; already included in recorded job costs."
          />
          <CardContent className="p-4">
            <SectionState
              pending={!state.crew && !errors.crew}
              error={errors.crew}
              empty={
                state.crew?.length === 0
                  ? "Add crew and record time to compare labor."
                  : undefined
              }
              retry={() => loadSection("crew")}
            >
              <div className="grid gap-4">
                {crewRows.slice(0, 8).map((row) => (
                  <div key={row.memberId}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="pf-emphasis truncate">{row.name}</p>
                        <p className="pf-helper">
                          {numberText(row.jobsWorked)} jobs
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="pf-emphasis">
                          {numberText(row.totalHours)} hrs
                        </p>
                        <p className="pf-helper">{moneyText(row.totalCost)}</p>
                      </div>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-2 h-2 rounded-full bg-[var(--pf-surface-muted)]"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--pf-success)]"
                        style={{
                          width: barWidth(
                            numeric(row.totalHours),
                            maxCrewHours,
                          ),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button as="a" href="/time" variant="ghost" className="mt-3">
                View time tracking
              </Button>
            </SectionState>
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader
            className="mb-0 border-b border-[var(--pf-border)] px-4 py-3"
            title="Contracted work by city"
            description="Jobsite location and accepted scope, before tax."
          />
          <CardContent className="p-4">
            <SectionState
              pending={!state.mix && !errors.mix}
              error={errors.mix}
              empty={
                state.mix && !cities.length
                  ? "Add jobsite cities to compare booked work."
                  : undefined
              }
              retry={() => loadSection("mix")}
            >
              <div className="grid gap-4">
                {cities.map((row) => (
                  <div key={row.label}>
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <p className="pf-emphasis min-w-0 truncate">
                        {row.label}
                      </p>
                      <p className="pf-emphasis">
                        {moneyText(row.contractedSubtotal)}{" "}
                        <span className="pf-helper">
                          ({numberText(row.jobs)} jobs)
                        </span>
                      </p>
                    </div>
                    {row.unresolvedJobs ? (
                      <p className="pf-helper mt-1">
                        {row.unresolvedJobs} job(s) need contract review
                      </p>
                    ) : (
                      <div
                        aria-hidden="true"
                        className="mt-2 h-2 rounded-full bg-[var(--pf-surface-muted)]"
                      >
                        <div
                          className="h-full rounded-full bg-[var(--pf-primary)]"
                          style={{
                            width: barWidth(
                              row.knownContractedSubtotal,
                              maxCityValue,
                            ),
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SectionState>
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader
            className="mb-0 border-b border-[var(--pf-border)] px-4 py-3"
            title="Job status"
          />
          <CardContent className="p-4">
            <SectionState
              pending={!state.mix && !errors.mix}
              error={errors.mix}
              empty={
                state.mix && !state.mix.statuses.length
                  ? "Accepted proposals create jobs to track here."
                  : undefined
              }
              retry={() => loadSection("mix")}
            >
              <div className="flex flex-wrap gap-2">
                {state.mix?.statuses.map((row) => (
                  <Badge
                    key={row.status}
                    variant={
                      row.status === "completed"
                        ? "success"
                        : row.status === "in_progress"
                          ? "warning"
                          : "info"
                    }
                  >
                    {labelize(row.status)}: {numberText(row.count)}
                  </Badge>
                ))}
              </div>
              <Button as="a" href="/jobs" variant="ghost" className="mt-3">
                View jobs
              </Button>
            </SectionState>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2" padding="none">
          <CardHeader
            className="mb-0 border-b border-[var(--pf-border)] px-4 py-3"
            title="Job cost position"
            description="Recorded costs against accepted scope. Missing costs never imply a final 100% margin."
          />
          <CardContent className="p-4">
            <SectionState
              pending={!state.margins && !errors.margins}
              error={errors.margins}
              empty={
                state.margins?.length === 0
                  ? "Record job costs to see cost positions."
                  : undefined
              }
              retry={() => loadSection("margins")}
            >
              <div className="divide-y divide-[var(--pf-border)]">
                {margins.map((row) => (
                  <Link
                    key={row.jobId}
                    to={`/jobs/${row.jobId}`}
                    className="flex min-h-12 min-w-0 items-center gap-3 py-3 text-inherit focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--pf-primary)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="pf-row-title truncate">
                        {row.title || "Untitled job"}
                      </p>
                      <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1">
                        <p className="pf-helper">
                          {moneyText(row.revenue)} contracted{" "}
                          <span aria-hidden="true">/</span>{" "}
                          {moneyText(row.costs)} costs
                        </p>
                        <p className={`pf-emphasis ${marginTone(row.margin)}`}>
                          {row.margin === null
                            ? "Not enough data"
                            : `${percentText(row.margin)} recorded margin`}
                        </p>
                      </div>
                      <p className="pf-helper mt-1">
                        {row.contractNeedsReview
                          ? "Contract needs review"
                          : row.unreviewedTimeCount
                            ? "Labor review pending"
                            : row.costCompleteness === "unknown"
                              ? "Costs not captured"
                              : "Cost capture incomplete"}
                      </p>
                    </div>
                    <Icon
                      name="chevron-right"
                      className="h-5 w-5 shrink-0 text-[var(--pf-text-muted)]"
                    />
                  </Link>
                ))}
              </div>
              {moreError && (
                <p
                  role="alert"
                  className="pf-copy mt-3 text-[var(--pf-danger)]"
                >
                  {moreError}
                </p>
              )}
              {nextCursor && (
                <Button
                  variant="secondary"
                  className="mt-4 w-full sm:w-auto"
                  isLoading={loadingMore}
                  disabled={!!pending.margins}
                  onClick={loadMore}
                >
                  {moreError ? "Retry more jobs" : "Load more jobs"}
                </Button>
              )}
            </SectionState>
          </CardContent>
        </Card>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button as="a" href="/invoices" variant="ghost">
          View payments
        </Button>
        <Button as="a" href="/reviews" variant="ghost">
          View review analytics
        </Button>
      </div>
    </main>
  );
}
