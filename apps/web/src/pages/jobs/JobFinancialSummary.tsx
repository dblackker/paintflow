import { useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/api";
import type { JobFinancialPosition } from "../../../../../packages/core/src/job-financial-position";

export type { JobFinancialPosition };

export function jobMoney(amount: { minor: number } | null | undefined) {
  return amount == null ? "Not available" : formatMoney(amount.minor / 100);
}

export function JobFinancialSummary({
  summary,
  jobId,
  estimateId,
  onAddCost,
  compact = false,
}: {
  summary?: JobFinancialPosition | null;
  jobId: string;
  estimateId?: string | null;
  onAddCost?: () => void;
  compact?: boolean;
}) {
  if (!summary)
    return (
      <p className="pf-copy py-3 text-[var(--pf-warning)]">
        Financial summary unavailable. Open the job to retry.
      </p>
    );
  const tone =
    summary.recordedMarginPercent === null
      ? "var(--pf-text-muted)"
      : summary.recordedMarginPercent >= 30
        ? "var(--pf-success)"
        : summary.recordedMarginPercent >= 15
          ? "var(--pf-warning)"
          : "var(--pf-danger)";
  return (
    <section aria-label="Job financial summary" className="min-w-0">
      <dl className="grid gap-2 sm:grid-cols-3">
        {[
          ["Contracted work", jobMoney(summary.contractedSubtotal)],
          ["Recorded costs", jobMoney(summary.recordedActualCost)],
          ["Cost position", jobMoney(summary.currentCostPosition)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 sm:block"
          >
            <dt className="pf-meta">{label}</dt>
            <dd className="pf-row-title whitespace-nowrap sm:mt-1">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--pf-border)] pt-3">
        <p className="pf-emphasis" style={{ color: tone }}>
          {summary.recordedMarginPercent === null
            ? "Margin unavailable"
            : `${summary.recordedMarginPercent.toLocaleString("en-US", { maximumFractionDigits: 1 })}% recorded margin`}
        </p>
        <p className="pf-helper">
          {summary.costCompleteness === "unknown"
            ? "Costs not captured"
            : "Cost capture incomplete"}
        </p>
      </div>
      {!compact && <p className="pf-helper mt-1">
        Before customer tax. Recorded costs are not final costs.
      </p>}
      {compact && summary.warnings.length > 0 && <Button as="a" href={`/jobs/${jobId}#job-costs`} variant="ghost">Review costs</Button>}
      {!compact && summary.warnings.length > 0 && (
        <div
          className="mt-3 grid gap-2 border-l-2 border-[var(--pf-warning)] pl-3"
          aria-label="Cost review needed"
        >
          {summary.warnings.map((warning) => (
            <div
              key={warning.code}
              className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1"
            >
              <p className="pf-helper w-full min-w-0 sm:w-auto sm:flex-1">
                {warning.code === "CONTRACT_SCOPE_UNRESOLVED"
                  ? "Accepted scope needs review."
                  : warning.code === "LABOR_REVIEW_PENDING"
                    ? `${summary.unreviewedTimeCount} time ${summary.unreviewedTimeCount === 1 ? "entry needs" : "entries need"} review.`
                    : summary.costRecordCount
                      ? "No net costs recorded."
                      : "No costs recorded."}
              </p>
              {warning.action === "add_cost" &&
                (onAddCost ? (
                  <Button variant="ghost" onClick={onAddCost}>
                    Add cost
                  </Button>
                ) : (
                  <Button
                    as="a"
                    href={`/jobs/${jobId}#job-costs`}
                    variant="ghost"
                  >
                    Add cost
                  </Button>
                ))}
              {warning.action === "review_time" && (
                <Button as="a" href={`/time?jobId=${jobId}`} variant="ghost">
                  Review time
                </Button>
              )}
              {warning.action === "review_scope" && (
                <Button
                  as="a"
                  href={
                    estimateId
                      ? `/estimates/${estimateId}/details`
                      : `/jobs/${jobId}`
                  }
                  variant="ghost"
                >
                  Review scope
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function JobActionMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        className="btn-icon btn-icon-tonal shrink-0"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="more-horizontal" className="h-5 w-5" />
      </button>
      <Modal isOpen={open} onClose={close} title="Job actions" size="sm">
        <div className="grid gap-2">{children(close)}</div>
      </Modal>
    </>
  );
}
