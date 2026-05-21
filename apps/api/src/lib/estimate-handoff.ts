import { auditLogs, estimates, jobs, leads } from '@paintflow/db/schema';
import type { DbClient } from '@paintflow/db/client';
import { and, eq } from 'drizzle-orm';

type EstimatePackage = {
  name: string;
  total: number | string;
  subtotal?: number | string;
};

type SelectedOption = {
  desc?: string;
  qty?: number | string;
  rate?: number | string;
  category?: string;
};

type AcceptedEstimate = typeof estimates.$inferSelect;

type HandoffInput = {
  packageName?: string | null;
  signedBy?: string | null;
  selectedOptions?: SelectedOption[];
  ipAddress?: string | null;
  userAgent?: string | null;
};

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPackages(estimate: AcceptedEstimate): EstimatePackage[] {
  return Array.isArray(estimate.packages) ? estimate.packages as EstimatePackage[] : [];
}

function jobScopeLabel(selectedPackage: EstimatePackage | null): string {
  const items = Array.isArray((selectedPackage as any)?.items)
    ? (selectedPackage as any).items
    : Array.isArray((selectedPackage as any)?.lineItems)
      ? (selectedPackage as any).lineItems
      : [];
  const text = items
    .map((item: any) => `${item?.desc ?? ''} ${item?.notes ?? ''}`)
    .join(' ')
    .toLowerCase();

  if (/(exterior|siding|fascia|soffit|roofline)/.test(text)) return 'Exterior';
  if (/(cabinet|vanity|built-in)/.test(text)) return 'Cabinets';
  if (/(commercial|office|workspace|tenant)/.test(text)) return 'Commercial';
  if (/(interior|bedroom|bathroom|kitchen|living|walls|ceilings|trim|doors)/.test(text)) return 'Interior';
  return 'Job';
}

export function buildJobName(lead: typeof leads.$inferSelect, selectedPackage: EstimatePackage | null): string {
  const street = lead.streetAddress?.trim();
  return [lead.name, jobScopeLabel(selectedPackage), street].filter(Boolean).join(' - ');
}

export function selectEstimatePackage(
  estimate: AcceptedEstimate,
  packageName?: string | null
): EstimatePackage | null {
  const packages = getPackages(estimate);
  if (packageName) {
    const selected = packages.find((pkg) => pkg.name === packageName);
    if (selected) return selected;
  }

  return packages.find((pkg) => /better|recommended/i.test(pkg.name)) ?? packages[0] ?? null;
}

export function estimateContractValue(
  estimate: AcceptedEstimate,
  packageName?: string | null,
  selectedOptions: SelectedOption[] = []
): number {
  const selected = selectEstimatePackage(estimate, packageName);
  const optionTotal = selectedOptions.reduce((sum, option) => {
    return sum + money(option.qty || 1) * money(option.rate);
  }, 0);
  return money(selected?.total ?? estimate.total) + optionTotal;
}

export async function createJobFromAcceptedEstimate(
  db: DbClient,
  estimate: AcceptedEstimate,
  input: HandoffInput = {}
) {
  const existingJob = await db.query.jobs.findFirst({
    where: and(eq(jobs.orgId, estimate.orgId), eq(jobs.estimateId, estimate.id)),
  });

  const contractValue = estimateContractValue(estimate, input.packageName, input.selectedOptions ?? []);

  if (existingJob) {
    await db.update(leads)
      .set({ status: 'won', updatedAt: new Date() })
      .where(and(eq(leads.id, estimate.leadId), eq(leads.orgId, estimate.orgId)));

    return existingJob;
  }

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, estimate.leadId), eq(leads.orgId, estimate.orgId)),
  });

  if (!lead) {
    throw new Error('Estimate lead was not found');
  }

  const selectedPackage = selectEstimatePackage(estimate, input.packageName);
  const [job] = await db.insert(jobs)
    .values({
      orgId: estimate.orgId,
      leadId: estimate.leadId,
      estimateId: estimate.id,
      name: buildJobName(lead, selectedPackage),
      status: 'scheduled',
      budget: contractValue.toFixed(2),
    })
    .returning();

  await db.update(leads)
    .set({ status: 'won', updatedAt: new Date() })
    .where(and(eq(leads.id, estimate.leadId), eq(leads.orgId, estimate.orgId)));

  await db.insert(auditLogs).values({
    orgId: estimate.orgId,
    action: 'estimate.accepted',
    entityType: 'estimate',
    entityId: estimate.id,
    metadata: {
      jobId: job.id,
      packageName: selectedPackage?.name ?? input.packageName ?? null,
      contractValue,
      signedBy: input.signedBy ?? null,
      selectedOptions: input.selectedOptions ?? [],
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  return job;
}
