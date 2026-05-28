import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb } from '../client';
import {
  auditLogs,
  changeOrders,
  estimateMaterials,
  estimatePhotos,
  estimateRoomItems,
  estimateRooms,
  estimates,
  estimateTemplates,
  jobAssignments,
  jobCosts,
  jobPhotos,
  jobs,
  leadSources,
  leads,
  materials,
  memberships,
  messageTemplates,
  messages,
  orgBranding,
  organizations,
  orgSettings,
  portalTokens,
  productionRates,
  reviewRequests,
  roles,
  serviceAreas,
  teamMembers,
  timeEntries,
  timePunchEvents,
  timePunchSessions,
  userRoles,
  users,
  materialPurchases,
} from '../schema';
import { goldenSeed } from './golden-data';

type Db = ReturnType<typeof createDb>;

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function dollars(value: number) {
  return value.toFixed(2);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function daysFromNow(days: number, hour = 8, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function sameDayAt(date: Date, hour: number, minute = 0) {
  const copy = new Date(date);
  copy.setHours(hour, minute, 0, 0);
  return copy;
}

function burdenedRate(member: { hourlyRate: string; burdenRate: string }) {
  return Number(member.hourlyRate) * (1 + Number(member.burdenRate) / 100);
}

function estimatePackage(name: string, items: Array<{ desc: string; qty: number; rate: number; category: string; notes?: string }>) {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const tax = subtotal * Number(goldenSeed.settings.salesTaxRate);
  return {
    name,
    subtotal: Number(subtotal.toFixed(2)),
    discount: 0,
    tax: Number(tax.toFixed(2)),
    total: Number((subtotal + tax).toFixed(2)),
    items,
    lineItems: items,
  };
}

async function findDemoOrg(db: Db) {
  return db.query.organizations.findFirst({
    where: eq(organizations.slug, goldenSeed.organization.slug),
  });
}

async function findDemoOwner(db: Db) {
  return db.query.users.findFirst({
    where: eq(users.email, goldenSeed.owner.email),
  });
}

async function deleteOrgData(db: Db, orgId: string) {
  const estimateRows = await db.select({ id: estimates.id }).from(estimates).where(eq(estimates.orgId, orgId));
  const estimateIds = estimateRows.map((row) => row.id);
  const roomRows = estimateIds.length
    ? await db.select({ id: estimateRooms.id }).from(estimateRooms).where(inArray(estimateRooms.estimateId, estimateIds))
    : [];
  const roomIds = roomRows.map((row) => row.id);
  const jobRows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.orgId, orgId));
  const jobIds = jobRows.map((row) => row.id);

  if (roomIds.length) await db.delete(estimateRoomItems).where(inArray(estimateRoomItems.roomId, roomIds));
  if (estimateIds.length) {
    await db.delete(estimatePhotos).where(inArray(estimatePhotos.estimateId, estimateIds));
    await db.delete(estimateMaterials).where(inArray(estimateMaterials.estimateId, estimateIds));
    await db.delete(estimateRooms).where(inArray(estimateRooms.estimateId, estimateIds));
  }
  if (jobIds.length) {
    await db.delete(jobAssignments).where(inArray(jobAssignments.jobId, jobIds));
    await db.delete(timePunchEvents).where(eq(timePunchEvents.orgId, orgId));
    await db.delete(timePunchSessions).where(eq(timePunchSessions.orgId, orgId));
    await db.delete(timeEntries).where(inArray(timeEntries.jobId, jobIds));
    await db.delete(jobCosts).where(inArray(jobCosts.jobId, jobIds));
    await db.delete(materialPurchases).where(inArray(materialPurchases.jobId, jobIds));
    await db.delete(changeOrders).where(inArray(changeOrders.jobId, jobIds));
    await db.delete(reviewRequests).where(inArray(reviewRequests.jobId, jobIds));
    await db.delete(jobPhotos).where(inArray(jobPhotos.jobId, jobIds));
  }

  await db.delete(auditLogs).where(eq(auditLogs.orgId, orgId));
  await db.delete(portalTokens).where(eq(portalTokens.orgId, orgId));
  await db.delete(messages).where(eq(messages.orgId, orgId));
  await db.delete(jobs).where(eq(jobs.orgId, orgId));
  await db.delete(estimates).where(eq(estimates.orgId, orgId));
  await db.delete(leads).where(eq(leads.orgId, orgId));
  await db.delete(teamMembers).where(eq(teamMembers.orgId, orgId));
  await db.delete(materials).where(eq(materials.orgId, orgId));
  await db.delete(productionRates).where(eq(productionRates.orgId, orgId));
  await db.delete(leadSources).where(eq(leadSources.orgId, orgId));
  await db.delete(estimateTemplates).where(eq(estimateTemplates.orgId, orgId));
  await db.delete(messageTemplates).where(eq(messageTemplates.orgId, orgId));
  await db.delete(userRoles).where(eq(userRoles.orgId, orgId));
  await db.delete(roles).where(eq(roles.orgId, orgId));
  await db.delete(serviceAreas).where(eq(serviceAreas.orgId, orgId));
  await db.delete(orgBranding).where(eq(orgBranding.orgId, orgId));
  await db.delete(orgSettings).where(eq(orgSettings.orgId, orgId));
  await db.delete(memberships).where(eq(memberships.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}

async function deleteDemoState(db: Db) {
  const orgIds = new Set<string>();
  const existing = await findDemoOrg(db);
  const owner = await findDemoOwner(db);

  if (existing) orgIds.add(existing.id);

  if (owner) {
    const ownerMemberships = await db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, owner.id));
    for (const membership of ownerMemberships) {
      orgIds.add(membership.orgId);
    }
  }

  for (const orgId of orgIds) {
    await deleteOrgData(db, orgId);
  }

  await db.delete(users).where(eq(users.email, goldenSeed.owner.email));
}

async function seed(db: Db) {
  await deleteDemoState(db);

  const [org] = await db.insert(organizations).values(goldenSeed.organization).returning();
  const [owner] = await db.insert(users).values(goldenSeed.owner).returning();
  await db.insert(memberships).values({ orgId: org.id, userId: owner.id, role: 'owner' });
  await db.insert(orgSettings).values({ orgId: org.id, ...goldenSeed.settings });
  await db.insert(orgBranding).values({ orgId: org.id, ...goldenSeed.branding });
  await db.insert(serviceAreas).values(goldenSeed.serviceAreas.map((area) => ({ orgId: org.id, ...area })));
  await db.insert(leadSources).values(goldenSeed.leadSources.map((source) => ({ orgId: org.id, ...source })));
  await db.insert(messageTemplates).values(goldenSeed.messageTemplates.map((template) => ({ orgId: org.id, ...template })));
  await db.insert(estimateTemplates).values(goldenSeed.estimateTemplates.map((template) => ({ orgId: org.id, createdBy: owner.id, ...template })));

  const roleRows = await db.insert(roles).values(goldenSeed.roles.map((role) => ({ orgId: org.id, ...role }))).returning();
  const ownerRole = roleRows.find((role) => role.name === 'Owner');
  if (ownerRole) await db.insert(userRoles).values({ orgId: org.id, userId: owner.id, roleId: ownerRole.id });

  const rateRows = await db.insert(productionRates).values(goldenSeed.productionRates.map((rate) => ({ orgId: org.id, ...rate }))).returning();
  const ratesByKey = new Map<string, (typeof rateRows)[number]>(goldenSeed.productionRates.map((rate, index) => [rate.key, rateRows[index]]));
  const materialRows = await db.insert(materials).values(goldenSeed.materials.map((material) => ({ orgId: org.id, ...material }))).returning();
  const materialsByKey = new Map<string, (typeof materialRows)[number]>(goldenSeed.materials.map((material, index) => [material.key, materialRows[index]]));
  const memberRows = await db.insert(teamMembers).values(goldenSeed.teamMembers.map(({ key: _key, ...member }) => ({ orgId: org.id, ...member }))).returning();
  const membersByKey = new Map<string, (typeof memberRows)[number]>(goldenSeed.teamMembers.map((member, index) => [member.key, memberRows[index]]));
  const leadRows = await db.insert(leads).values(goldenSeed.leads.map(({ key: _key, ...lead }) => ({ orgId: org.id, ...lead }))).returning();
  const leadsByKey = new Map<string, (typeof leadRows)[number]>(goldenSeed.leads.map((lead, index) => [lead.key, leadRows[index]]));

  await db.insert(messages).values(goldenSeed.messages.map((message) => ({
    orgId: org.id,
    leadId: leadsByKey.get(message.leadKey)!.id,
    direction: message.direction,
    fromNumber: message.fromNumber,
    toNumber: message.toNumber,
    body: message.body,
    read: message.direction === 'outbound',
    createdAt: daysAgo(message.direction === 'outbound' ? 5 : 4),
  })));

  const jessicaItems = [
    {
      desc: 'Living room: Interior walls',
      qty: 1,
      rate: 2680,
      category: 'sqft',
      notes: 'Neutral repaint, 2 coats, Benjamin Moore Regal Select, color TBD',
      kind: 'surface',
      customerVisible: true,
      dimensions: { quantity: 760, unit: 'sqft' },
      labor: { hours: 4.2, rate: 68, cost: 285.6, coats: 2, prepLevel: 'standard', applicationMethod: 'brush_roll', productionRatePerHour: 390 },
      material: { id: materialsByKey.get('wallPaint')!.id, name: 'Regal Select Interior Matte', brand: 'Benjamin Moore', supplier: 'NorCal Paint Supply', unit: 'gallon', quantity: 4, costPerUnit: 48, markupPercent: 32, price: 253.44, colorName: 'Classic Gray', colorCode: 'OC-23', status: 'Approved' },
    },
    {
      desc: 'Bedrooms: Walls and ceilings',
      qty: 1,
      rate: 4125,
      category: 'sqft',
      notes: 'Three bedrooms, ceilings included, standard prep',
      kind: 'surface',
      customerVisible: true,
      dimensions: { quantity: 1320, unit: 'sqft' },
      labor: { hours: 9.8, rate: 68, cost: 666.4, coats: 2, prepLevel: 'standard', applicationMethod: 'brush_roll', productionRatePerHour: 390 },
      material: { id: materialsByKey.get('wallPaint')!.id, name: 'Regal Select Interior Matte', brand: 'Benjamin Moore', supplier: 'NorCal Paint Supply', unit: 'gallon', quantity: 7, costPerUnit: 48, markupPercent: 32, price: 443.52, colorName: 'White Dove', colorCode: 'OC-17', status: 'Selected' },
    },
    { desc: 'Stairwell trim option', qty: 1, rate: 850, category: 'option', notes: 'Customer-requested add option', kind: 'line_item', customerVisible: true },
  ];
  const jessicaPackage = estimatePackage('proposal', jessicaItems);
  const [jessicaEstimate] = await db.insert(estimates).values({
    orgId: org.id,
    leadId: leadsByKey.get('jessica')!.id,
    packages: [jessicaPackage],
    total: dollars(jessicaPackage.total),
    status: 'sent',
    sentAt: daysAgo(2),
    createdAt: daysAgo(2),
  }).returning();

  const robertItems = [
    { desc: 'Exterior siding: wash, scrape, prime bare areas, spray/back-roll', qty: 1, rate: 9450, category: 'sqft', notes: 'Two-story exterior, satin finish', kind: 'surface', customerVisible: true },
    { desc: 'Fascia, soffits, window and door trim', qty: 1, rate: 3850, category: 'trim', notes: 'Estimated from perimeter and roofline factor', kind: 'surface', customerVisible: true },
  ];
  const robertPackage = estimatePackage('proposal', robertItems);
  const [robertEstimate] = await db.insert(estimates).values({
    orgId: org.id,
    leadId: leadsByKey.get('robert')!.id,
    packages: [robertPackage],
    total: dollars(robertPackage.total),
    status: 'accepted',
    sentAt: daysAgo(18),
    signedName: 'Robert Chen',
    signatureData: 'demo-signature',
    signedAt: daysAgo(14),
    createdAt: daysAgo(18),
  }).returning();

  const [robertJob] = await db.insert(jobs).values({
    orgId: org.id,
    leadId: leadsByKey.get('robert')!.id,
    estimateId: robertEstimate.id,
    name: 'Robert Chen Exterior Repaint',
    status: 'in_progress',
    budget: dollars(robertPackage.total),
    scheduledStartAt: daysAgo(3),
    scheduledEndAt: daysFromNow(1, 16),
    createdAt: daysAgo(14),
  }).returning();

  const [harperJob] = await db.insert(jobs).values({
    orgId: org.id,
    leadId: leadsByKey.get('harper')!.id,
    name: 'Harper & Co Office Refresh',
    status: 'scheduled',
    budget: '18400.00',
    scheduledStartAt: daysFromNow(2, 8),
    scheduledEndAt: daysFromNow(4, 16),
    createdAt: daysAgo(6),
  }).returning();

  await db.insert(jobCosts).values([
    { orgId: org.id, jobId: robertJob.id, category: 'materials', description: 'Exterior paint and primer order', quantity: '1.00', unitCost: '1850.00', totalCost: '1850.00', costDate: daysAgo(5) },
    { orgId: org.id, jobId: robertJob.id, category: 'supplies', description: 'Masking, caulk, sundries', quantity: '1.00', unitCost: '415.00', totalCost: '415.00', costDate: daysAgo(4) },
    { orgId: org.id, jobId: harperJob.id, category: 'materials', description: 'Deposit material order', quantity: '1.00', unitCost: '980.00', totalCost: '980.00', costDate: daysAgo(2) },
  ]);

  const timeRows = [
    { jobId: robertJob.id, memberKey: 'nick', hours: 8, date: daysAgo(3), description: 'Pressure wash, scrape, spot prime', start: [47.6295, -122.3602], end: [47.6299, -122.3596] },
    { jobId: robertJob.id, memberKey: 'maria', hours: 7.5, date: daysAgo(3), description: 'Mask windows and fixtures', start: [47.6293, -122.3604], end: [47.6297, -122.3598] },
    { jobId: robertJob.id, memberKey: 'devon', hours: 8, date: daysAgo(2), description: 'Spray and back-roll north elevation', start: [47.6296, -122.3601], end: [47.63, -122.3597] },
    { jobId: harperJob.id, memberKey: 'sam', hours: 5, date: daysAgo(1), description: 'Site protection and patching', start: [47.6068, -122.3351], end: [47.6071, -122.3346] },
  ];
  const insertedTimeRows = timeRows.map((row) => {
    const memberSeed = goldenSeed.teamMembers.find((member) => member.key === row.memberKey)!;
    const member = membersByKey.get(row.memberKey)!;
    const rate = burdenedRate(memberSeed);
    return {
      orgId: org.id,
      jobId: row.jobId,
      teamMemberId: member.id,
      hours: dollars(row.hours),
      date: row.date,
      description: row.description,
      hourlyRate: dollars(rate),
      totalCost: dollars(row.hours * rate),
      source: 'punch_clock',
      reviewStatus: 'approved',
      actualStartAt: sameDayAt(row.date, 8),
      actualEndAt: sameDayAt(row.date, 8 + Math.floor(row.hours), (row.hours % 1) * 60),
      roundedStartAt: sameDayAt(row.date, 8),
      roundedEndAt: sameDayAt(row.date, 8 + Math.floor(row.hours), (row.hours % 1) * 60),
      startLatitude: row.start[0].toFixed(7),
      startLongitude: row.start[1].toFixed(7),
      startAccuracyMeters: '18.00',
      endLatitude: row.end[0].toFixed(7),
      endLongitude: row.end[1].toFixed(7),
      endAccuracyMeters: '21.00',
    };
  });
  const createdTimeEntries = await db.insert(timeEntries).values(insertedTimeRows).returning();
  const createdPunchSessions = await db.insert(timePunchSessions).values(createdTimeEntries.map((entry, index) => ({
    orgId: org.id,
    jobId: entry.jobId,
    teamMemberId: entry.teamMemberId,
    timeEntryId: entry.id,
    status: 'approved',
    startedAtActual: entry.actualStartAt!,
    endedAtActual: entry.actualEndAt,
    startedAtRounded: entry.roundedStartAt!,
    endedAtRounded: entry.roundedEndAt,
    roundingIncrementMinutes: 15,
    startLatitude: insertedTimeRows[index].startLatitude,
    startLongitude: insertedTimeRows[index].startLongitude,
    startAccuracyMeters: insertedTimeRows[index].startAccuracyMeters,
    endLatitude: insertedTimeRows[index].endLatitude,
    endLongitude: insertedTimeRows[index].endLongitude,
    endAccuracyMeters: insertedTimeRows[index].endAccuracyMeters,
  }))).returning();
  await db.insert(timePunchEvents).values(createdPunchSessions.flatMap((session, index) => ([
    {
      orgId: org.id,
      punchSessionId: session.id,
      eventType: 'clock_in',
      latitude: insertedTimeRows[index].startLatitude,
      longitude: insertedTimeRows[index].startLongitude,
      accuracyMeters: insertedTimeRows[index].startAccuracyMeters,
      occurredAt: session.startedAtActual,
    },
    {
      orgId: org.id,
      punchSessionId: session.id,
      eventType: 'clock_out',
      latitude: insertedTimeRows[index].endLatitude,
      longitude: insertedTimeRows[index].endLongitude,
      accuracyMeters: insertedTimeRows[index].endAccuracyMeters,
      occurredAt: session.endedAtActual!,
    },
  ])));

  const missingJobMember = membersByKey.get('devon')!;
  const missingJobRate = burdenedRate(goldenSeed.teamMembers.find((member) => member.key === 'devon')!);
  const missingJobDate = daysAgo(0);
  const [missingJobEntry] = await db.insert(timeEntries).values({
    orgId: org.id,
    jobId: null,
    teamMemberId: missingJobMember.id,
    hours: '2.00',
    date: sameDayAt(missingJobDate, 8),
    description: 'Clocked in before selecting the job',
    hourlyRate: dollars(missingJobRate),
    totalCost: dollars(2 * missingJobRate),
    source: 'punch_clock',
    reviewStatus: 'flagged',
    reviewReason: 'missing_job_assignment',
    actualStartAt: sameDayAt(missingJobDate, 8),
    actualEndAt: sameDayAt(missingJobDate, 10),
    roundedStartAt: sameDayAt(missingJobDate, 8),
    roundedEndAt: sameDayAt(missingJobDate, 10),
    startLatitude: '47.6245000',
    startLongitude: '-122.3569000',
    startAccuracyMeters: '24.00',
    endLatitude: '47.6251000',
    endLongitude: '-122.3561000',
    endAccuracyMeters: '27.00',
  }).returning();
  const [missingJobSession] = await db.insert(timePunchSessions).values({
    orgId: org.id,
    jobId: null,
    teamMemberId: missingJobMember.id,
    timeEntryId: missingJobEntry.id,
    status: 'manual_override',
    startedAtActual: missingJobEntry.actualStartAt!,
    endedAtActual: missingJobEntry.actualEndAt,
    startedAtRounded: missingJobEntry.roundedStartAt!,
    endedAtRounded: missingJobEntry.roundedEndAt,
    roundingIncrementMinutes: 15,
    startLatitude: missingJobEntry.startLatitude,
    startLongitude: missingJobEntry.startLongitude,
    startAccuracyMeters: missingJobEntry.startAccuracyMeters,
    endLatitude: missingJobEntry.endLatitude,
    endLongitude: missingJobEntry.endLongitude,
    endAccuracyMeters: missingJobEntry.endAccuracyMeters,
    reviewRequired: true,
    reviewReason: 'missing_job_assignment',
    crewNote: 'Crew forgot to choose the job from the field.',
  }).returning();
  await db.insert(timePunchEvents).values([
    {
      orgId: org.id,
      punchSessionId: missingJobSession.id,
      eventType: 'forgot_clock_in',
      latitude: missingJobEntry.startLatitude,
      longitude: missingJobEntry.startLongitude,
      accuracyMeters: missingJobEntry.startAccuracyMeters,
      occurredAt: missingJobEntry.actualStartAt!,
      metadata: { reviewReason: 'missing_job_assignment' },
    },
    {
      orgId: org.id,
      punchSessionId: missingJobSession.id,
      eventType: 'manual_clock_out',
      latitude: missingJobEntry.endLatitude,
      longitude: missingJobEntry.endLongitude,
      accuracyMeters: missingJobEntry.endAccuracyMeters,
      occurredAt: missingJobEntry.actualEndAt!,
      metadata: { reviewReason: 'missing_job_assignment' },
    },
  ]);
  await db.insert(jobCosts).values(insertedTimeRows.map((row) => ({
    orgId: org.id,
    jobId: row.jobId,
    category: 'labor',
    description: row.description ?? 'Crew labor',
    quantity: row.hours,
    unitCost: row.hourlyRate,
    totalCost: row.totalCost,
    costDate: row.date,
  })));

  await db.insert(materialPurchases).values({
    orgId: org.id,
    jobId: robertJob.id,
    supplier: 'Sherwin-Williams',
    invoiceNumber: 'SW-2026-1044',
    invoiceDate: daysAgo(5),
    totalAmount: '1850.00',
    parsedData: [{ sku: 'SW-DURATION-SAT', qty: 18, unitCost: 62 }],
  });

  await db.insert(changeOrders).values({
    orgId: org.id,
    jobId: robertJob.id,
    estimateId: robertEstimate.id,
    description: 'Add detached garage side door and jamb',
    amount: '420.00',
    status: 'approved',
    approvedAt: daysAgo(1),
    createdBy: 'customer',
  });

  await db.insert(reviewRequests).values({
    orgId: org.id,
    jobId: robertJob.id,
    leadId: leadsByKey.get('robert')!.id,
    status: 'pending',
    createdAt: daysAgo(1),
  });

  await db.insert(estimateMaterials).values([
    { estimateId: jessicaEstimate.id, materialId: materialsByKey.get('wallPaint')!.id, name: 'Regal Select Interior Matte', quantity: '11.00', unit: 'gallon', costPerUnit: '48.00', markupPercent: '32.00', totalCost: '528.00', totalPrice: '696.96' },
    { estimateId: robertEstimate.id, materialId: materialsByKey.get('exteriorPaint')!.id, name: 'Duration Exterior Satin', quantity: '18.00', unit: 'gallon', costPerUnit: '62.00', markupPercent: '35.00', totalCost: '1116.00', totalPrice: '1506.60' },
  ]);

  return {
    org,
    owner,
    counts: {
      leads: leadRows.length,
      estimates: 2,
      jobs: 2,
      teamMembers: memberRows.length,
      timeEntries: insertedTimeRows.length,
      materials: materialRows.length,
      productionRates: rateRows.length,
    },
  };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), '.env'));
  loadEnvFile(resolve(process.cwd(), '..', '..', '.env'));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Put it in .env or pass it as an environment variable.');
  }

  const db = createDb(databaseUrl);
  const result = await seed(db);
  console.log(`Seeded golden demo workspace: ${result.org.name} (${result.org.slug})`);
  console.log(`Demo owner: ${result.owner.email}`);
  console.table(result.counts);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
