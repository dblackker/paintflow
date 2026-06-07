import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb } from '../client';
import {
  auditLogs,
  activities,
  aiUsageEvents,
  changeOrders,
  estimateMaterials,
  estimatePhotos,
  estimateRoomItems,
  estimateRooms,
  estimates,
  estimateTemplates,
  emailSends,
  customerInvoices,
  customerPayments,
  expenses,
  emailTemplates,
  googleCalendarConnections,
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
  notificationEvents,
  notificationReads,
  pushSubscriptions,
  orgBranding,
  organizations,
  orgSettings,
  portalTokens,
  productionRates,
  reviewRequests,
  roles,
  serviceAreas,
  stripeConnections,
  quickbooksConnections,
  subscriptions,
  teamMembers,
  timeEntries,
  timePunchEvents,
  timePunchSessions,
  userRoles,
  users,
  materialPurchases,
  supplierInvoiceImportFeedback,
  supplierInvoiceImports,
  supplierInvoiceLearningStats,
  supplierInvoiceSenderRules,
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
  await db.delete(customerPayments).where(eq(customerPayments.orgId, orgId));
  await db.delete(emailSends).where(eq(emailSends.orgId, orgId));
  await db.delete(customerInvoices).where(eq(customerInvoices.orgId, orgId));
  await db.delete(timePunchEvents).where(eq(timePunchEvents.orgId, orgId));
  await db.delete(timePunchSessions).where(eq(timePunchSessions.orgId, orgId));
  await db.delete(timeEntries).where(eq(timeEntries.orgId, orgId));

  if (jobIds.length) {
    await db.delete(jobAssignments).where(inArray(jobAssignments.jobId, jobIds));
    await db.delete(expenses).where(inArray(expenses.jobId, jobIds));
    await db.delete(jobCosts).where(inArray(jobCosts.jobId, jobIds));
    await db.delete(supplierInvoiceImportFeedback).where(eq(supplierInvoiceImportFeedback.orgId, orgId));
    await db.delete(supplierInvoiceImports).where(eq(supplierInvoiceImports.orgId, orgId));
    await db.delete(materialPurchases).where(inArray(materialPurchases.jobId, jobIds));
    await db.delete(changeOrders).where(inArray(changeOrders.jobId, jobIds));
    await db.delete(reviewRequests).where(inArray(reviewRequests.jobId, jobIds));
    await db.delete(jobPhotos).where(inArray(jobPhotos.jobId, jobIds));
  }

  await db.delete(supplierInvoiceSenderRules).where(eq(supplierInvoiceSenderRules.orgId, orgId));
  await db.delete(supplierInvoiceLearningStats).where(eq(supplierInvoiceLearningStats.orgId, orgId));
  await db.delete(notificationReads).where(eq(notificationReads.orgId, orgId));
  await db.delete(notificationEvents).where(eq(notificationEvents.orgId, orgId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.orgId, orgId));
  await db.delete(activities).where(eq(activities.orgId, orgId));
  await db.delete(aiUsageEvents).where(eq(aiUsageEvents.orgId, orgId));
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
  await db.delete(emailTemplates).where(eq(emailTemplates.orgId, orgId));
  await db.delete(messageTemplates).where(eq(messageTemplates.orgId, orgId));
  await db.delete(userRoles).where(eq(userRoles.orgId, orgId));
  await db.delete(roles).where(eq(roles.orgId, orgId));
  await db.delete(serviceAreas).where(eq(serviceAreas.orgId, orgId));
  await db.delete(stripeConnections).where(eq(stripeConnections.orgId, orgId));
  await db.delete(quickbooksConnections).where(eq(quickbooksConnections.orgId, orgId));
  await db.delete(googleCalendarConnections).where(eq(googleCalendarConnections.orgId, orgId));
  await db.delete(orgBranding).where(eq(orgBranding.orgId, orgId));
  await db.delete(orgSettings).where(eq(orgSettings.orgId, orgId));
  await db.delete(subscriptions).where(eq(subscriptions.orgId, orgId));
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
    streetAddress: '742 Noe St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94114',
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
    streetAddress: '1818 Lake St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94121',
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
    jobNumber: 'GB-2026-014',
    name: 'Robert Chen Exterior Repaint',
    streetAddress: '1818 Lake St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94121',
    status: 'in_progress',
    budget: dollars(robertPackage.total),
    scheduledStartAt: daysAgo(3),
    scheduledEndAt: daysFromNow(1, 16),
    createdAt: daysAgo(14),
  }).returning();

  const [harperJob] = await db.insert(jobs).values({
    orgId: org.id,
    leadId: leadsByKey.get('harper')!.id,
    jobNumber: 'GB-2026-018',
    name: 'Harper & Co Office Refresh',
    streetAddress: '420 Bryant St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94107',
    status: 'scheduled',
    budget: '18400.00',
    scheduledStartAt: daysFromNow(2, 8),
    scheduledEndAt: daysFromNow(4, 16),
    createdAt: daysAgo(6),
  }).returning();

  await db.insert(jobCosts).values([
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

  const [robertPurchase] = await db.insert(materialPurchases).values({
    orgId: org.id,
    jobId: robertJob.id,
    supplier: 'Sherwin-Williams',
    invoiceNumber: 'SW-2026-1044',
    invoiceDate: daysAgo(5),
    documentHash: 'demo-robert-sw-2026-1044',
    totalAmount: '1850.00',
    fileUrl: 'https://dummyimage.com/900x1200/f8fafc/334155.png&text=Sherwin-Williams+Invoice+SW-2026-1044',
    parsedData: [
      { sku: 'SW-DURATION-SAT', product: 'Duration Exterior Satin', qty: 18, unit: 'gallon', unitCost: 62, total: 1116 },
      { sku: 'SW-EXT-PRIMER', product: 'Exterior wood primer', qty: 8, unit: 'gallon', unitCost: 38, total: 304 },
      { sku: 'SUNDRIES', product: 'Masking, caulk, rollers', qty: 1, unit: 'job', unitCost: 430, total: 430 },
    ],
  }).returning();

  const [garageDoorChangeOrder] = await db.insert(changeOrders).values({
    orgId: org.id,
    jobId: robertJob.id,
    estimateId: robertEstimate.id,
    description: 'Add detached garage side door and jamb',
    scopeDetails: {
      items: [
        { area: 'Detached garage', substrate: 'Door and jamb', coats: 2, prep: 'Light sand and spot prime', paint: 'Duration Exterior Satin', color: 'Match body color' },
      ],
    },
    amount: '420.00',
    status: 'approved',
    sentAt: daysAgo(2),
    paymentRequired: true,
    depositPercent: '100.00',
    paymentStatus: 'paid',
    paymentDueAmount: '420.00',
    paidAt: daysAgo(1),
    approvedBy: 'Robert Chen',
    contractorSignature: { name: 'Daniel Demo', title: 'Owner', signedAt: daysAgo(2).toISOString() },
    customerSignatureName: 'Robert Chen',
    customerSignatureData: 'demo-change-order-signature',
    customerSignedAt: daysAgo(1),
    approvedAt: daysAgo(1),
    createdBy: 'customer',
  }).returning();

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

  const [livingRoom] = await db.insert(estimateRooms).values({
    estimateId: jessicaEstimate.id,
    name: 'Living Room',
    roomType: 'living_room',
  }).returning();
  const [bedroomSuite] = await db.insert(estimateRooms).values({
    estimateId: jessicaEstimate.id,
    name: 'Bedroom Suite',
    roomType: 'bedroom',
  }).returning();
  await db.insert(estimateRoomItems).values([
    { roomId: livingRoom.id, productionRateId: ratesByKey.get('walls')!.id, category: 'Walls', width: '18.00', height: '9.00', length: '68.00', quantity: '760.00', coats: 2, prepLevel: 'standard', notes: 'Benjamin Moore Classic Gray OC-23' },
    { roomId: livingRoom.id, productionRateId: ratesByKey.get('trim')!.id, category: 'Trim', length: '118.00', quantity: '118.00', coats: 2, prepLevel: 'standard', notes: 'White Dove OC-17 semi-gloss' },
    { roomId: bedroomSuite.id, productionRateId: ratesByKey.get('walls')!.id, category: 'Walls', width: '12.00', height: '9.00', length: '48.00', quantity: '1320.00', coats: 2, prepLevel: 'standard', notes: 'Three bedrooms, all walls same color' },
    { roomId: bedroomSuite.id, productionRateId: ratesByKey.get('ceilings')!.id, category: 'Ceilings', width: '12.00', height: '12.00', quantity: '430.00', coats: 1, prepLevel: 'light', notes: 'Flat white ceiling paint' },
  ]);
  await db.insert(estimatePhotos).values([
    {
      estimateId: jessicaEstimate.id,
      roomId: livingRoom.id,
      url: 'https://dummyimage.com/1000x750/e2e8f0/334155.png&text=Living+Room+Wall+Condition',
      annotations: [{ x: 44, y: 38, text: 'Patch picture hook holes before finish coat', color: '#b45309' }],
      createdAt: daysAgo(2),
    },
    {
      estimateId: jessicaEstimate.id,
      roomId: bedroomSuite.id,
      url: 'https://dummyimage.com/1000x750/eef2ff/334155.png&text=Bedroom+Suite+Scope',
      annotations: [{ x: 52, y: 42, text: 'Ceiling color separate from walls', color: '#2563eb' }],
      createdAt: daysAgo(2),
    },
  ]);

  await db.insert(jobPhotos).values([
    { orgId: org.id, jobId: robertJob.id, key: 'demo/jobs/robert/before-front.png', url: 'https://dummyimage.com/1000x750/e5e7eb/334155.png&text=Before+-+Front+Elevation', caption: 'Before photo: front elevation, peeling fascia noted.', type: 'before', createdAt: daysAgo(5) },
    { orgId: org.id, jobId: robertJob.id, key: 'demo/jobs/robert/progress-north.png', url: 'https://dummyimage.com/1000x750/dbeafe/1e3a8a.png&text=Progress+-+North+Elevation', caption: 'North elevation sprayed and back-rolled after spot prime.', type: 'progress', createdAt: daysAgo(2) },
    { orgId: org.id, jobId: harperJob.id, key: 'demo/jobs/harper/site-protection.png', url: 'https://dummyimage.com/1000x750/fef3c7/92400e.png&text=Office+Site+Protection', caption: 'Site protection staged before office refresh.', type: 'progress', createdAt: daysAgo(1) },
  ]);

  const portalTokenValues = [
    { leadKey: 'jessica', token: 'demo-jessica-portal-token', expiresAt: daysFromNow(60) },
    { leadKey: 'robert', token: 'demo-robert-portal-token', expiresAt: daysFromNow(60), lastAccessedAt: daysAgo(1) },
    { leadKey: 'harper', token: 'demo-harper-portal-token', expiresAt: daysFromNow(60) },
    { leadKey: 'thompson', token: 'demo-thompson-portal-token', expiresAt: daysFromNow(60) },
  ];
  await db.insert(portalTokens).values(portalTokenValues.map((token) => ({
    orgId: org.id,
    leadId: leadsByKey.get(token.leadKey)!.id,
    token: token.token,
    expiresAt: token.expiresAt,
    lastAccessedAt: token.lastAccessedAt ?? null,
  })));

  const robertDepositTotal = 5786.32;
  const robertFinalTotal = 8679.48;
  const harperDepositTotal = 5520;
  const thompsonRefundTotal = 925;
  const [robertDepositInvoice, robertFinalInvoice, harperDepositInvoice, thompsonRefundedInvoice, robertChangeOrderInvoice] = await db.insert(customerInvoices).values([
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      estimateId: robertEstimate.id,
      jobId: robertJob.id,
      invoiceNumber: 'INV-20260518-ROB-DEP',
      description: 'Deposit invoice for Robert Chen exterior repaint',
      lineItems: [{ description: '40% deposit to reserve production schedule', quantity: 1, unitPrice: robertDepositTotal, total: robertDepositTotal, category: 'deposit' }],
      subtotal: dollars(robertDepositTotal),
      tax: '0.00',
      total: dollars(robertDepositTotal),
      status: 'paid',
      dueDate: daysAgo(12),
      dueLabel: 'Paid deposit',
      reminderCadence: 'none',
      note: 'Deposit received by card after proposal signature.',
      sentAt: daysAgo(14),
      paidAt: daysAgo(13),
      createdBy: owner.id,
      createdAt: daysAgo(14),
      updatedAt: daysAgo(13),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      estimateId: robertEstimate.id,
      jobId: robertJob.id,
      invoiceNumber: 'INV-20260529-ROB-FINAL',
      description: 'Final balance for Robert Chen exterior repaint',
      lineItems: [{ description: 'Remaining project balance due on completion', quantity: 1, unitPrice: robertFinalTotal, total: robertFinalTotal, category: 'final_payment' }],
      subtotal: dollars(robertFinalTotal),
      tax: '0.00',
      total: dollars(robertFinalTotal),
      status: 'sent',
      dueDate: daysFromNow(2, 17),
      dueLabel: 'Due on completion',
      reminderCadence: 'due_date',
      note: 'Send after final walkthrough approval.',
      sentAt: daysAgo(1),
      createdBy: owner.id,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('harper')!.id,
      jobId: harperJob.id,
      invoiceNumber: 'INV-20260528-HAR-DEP',
      description: 'Deposit invoice for Harper & Co office refresh',
      lineItems: [{ description: '30% scheduling deposit for office repaint', quantity: 1, unitPrice: harperDepositTotal, total: harperDepositTotal, category: 'deposit' }],
      subtotal: dollars(harperDepositTotal),
      tax: '0.00',
      total: dollars(harperDepositTotal),
      status: 'sent',
      dueDate: daysFromNow(1, 17),
      dueLabel: 'Due before first work day',
      reminderCadence: 'daily_until_paid',
      note: 'Payment due before crew is dispatched.',
      sentAt: daysAgo(2),
      createdBy: owner.id,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('thompson')!.id,
      invoiceNumber: 'INV-20260509-THO-CONSULT',
      description: 'Color consultation deposit',
      lineItems: [{ description: 'Refundable color consultation deposit', quantity: 1, unitPrice: thompsonRefundTotal, total: thompsonRefundTotal, category: 'consultation' }],
      subtotal: dollars(thompsonRefundTotal),
      tax: '0.00',
      total: dollars(thompsonRefundTotal),
      status: 'refunded',
      dueDate: daysAgo(20),
      dueLabel: 'Refunded',
      reminderCadence: 'none',
      note: 'Customer chose another contractor; deposit refunded by check.',
      sentAt: daysAgo(24),
      paidAt: daysAgo(22),
      createdBy: owner.id,
      createdAt: daysAgo(24),
      updatedAt: daysAgo(19),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      estimateId: robertEstimate.id,
      jobId: robertJob.id,
      changeOrderId: garageDoorChangeOrder.id,
      invoiceNumber: 'INV-20260527-ROB-CO1',
      description: 'Change order: detached garage side door and jamb',
      lineItems: [{ description: 'Approved change order CO-1', quantity: 1, unitPrice: 420, total: 420, category: 'change_order' }],
      subtotal: '420.00',
      tax: '0.00',
      total: '420.00',
      status: 'paid',
      dueDate: daysAgo(1),
      dueLabel: 'Paid on approval',
      reminderCadence: 'none',
      sentAt: daysAgo(2),
      paidAt: daysAgo(1),
      createdBy: owner.id,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
  ]).returning();

  const [robertDepositPayment, thompsonRefundedPayment, changeOrderPayment] = await db.insert(customerPayments).values([
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      estimateId: robertEstimate.id,
      jobId: robertJob.id,
      invoiceId: robertDepositInvoice.id,
      source: 'stripe',
      status: 'succeeded',
      amount: dollars(robertDepositTotal),
      description: 'Card deposit payment',
      stripeCheckoutSessionId: 'cs_test_demo_robert_deposit',
      stripePaymentIntentId: 'pi_demo_robert_deposit',
      stripeChargeId: 'ch_demo_robert_deposit',
      receivedAt: daysAgo(13),
      metadata: { receiptEmailSent: true, paymentScheduleMilestone: 'deposit' },
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('thompson')!.id,
      invoiceId: thompsonRefundedInvoice.id,
      source: 'check',
      status: 'refunded',
      amount: dollars(thompsonRefundTotal),
      refundedAmount: dollars(thompsonRefundTotal),
      description: 'Check payment later refunded after canceled project',
      receivedAt: daysAgo(22),
      refundedAt: daysAgo(19),
      metadata: {
        reference: 'Check 1184',
        refundHistory: [{ amount: thompsonRefundTotal, method: 'check', reference: 'Refund check 1192', reason: 'Customer canceled before work started', refundedAt: daysAgo(19).toISOString() }],
      },
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      estimateId: robertEstimate.id,
      jobId: robertJob.id,
      changeOrderId: garageDoorChangeOrder.id,
      invoiceId: robertChangeOrderInvoice.id,
      source: 'ach',
      status: 'succeeded',
      amount: '420.00',
      description: 'ACH payment for approved change order',
      receivedAt: daysAgo(1),
      metadata: { reference: 'ACH demo CO-1' },
    },
  ]).returning();

  const emailShell = (headline: string, body: string, cta: string, href: string) => `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px;margin:0 auto;padding:24px">
      <img src="${goldenSeed.branding.logoUrl}" alt="${goldenSeed.organization.name}" style="max-width:180px;height:auto;margin-bottom:24px" />
      <h1 style="font-size:24px;line-height:1.2;margin:0 0 12px">${headline}</h1>
      <p style="font-size:16px;margin:0 0 20px">${body}</p>
      <a href="${href}" style="display:inline-block;background:#176b5b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">${cta}</a>
      <p style="font-size:13px;color:#6b7280;margin-top:24px">Golden Brush Painting<br />1800 Mission St, San Francisco, CA 94103</p>
    </div>`;

  await db.insert(emailSends).values([
    {
      orgId: org.id,
      leadId: leadsByKey.get('jessica')!.id,
      estimateId: jessicaEstimate.id,
      templateKey: 'estimate.interior.sent',
      templateName: 'Interior estimate sent',
      toEmail: 'jessica.park@example.com',
      fromEmail: 'hello@goldenbrush.example',
      replyTo: 'hello@goldenbrush.example',
      subject: 'Your interior repaint proposal is ready',
      previewText: 'Review the room-by-room proposal and optional trim scope.',
      renderedHtml: emailShell('Your proposal is ready', 'We prepared a room-by-room interior repaint proposal with products, colors, and an optional trim add-on.', 'Review proposal', 'https://crewmodo.com/portal/demo-jessica-portal-token'),
      renderedText: 'Your interior repaint proposal is ready: https://crewmodo.com/portal/demo-jessica-portal-token',
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'demo-email-jessica-estimate',
      sentBy: owner.id,
      sentAt: daysAgo(2),
      createdAt: daysAgo(2),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      estimateId: robertEstimate.id,
      templateKey: 'invoice.deposit.created',
      templateName: 'Deposit invoice ready',
      toEmail: 'robert.chen@example.com',
      fromEmail: 'hello@goldenbrush.example',
      replyTo: 'hello@goldenbrush.example',
      subject: 'Your deposit invoice is ready',
      previewText: 'Pay the deposit to secure your production slot.',
      renderedHtml: emailShell('Your project is signed', 'Thanks for approving the exterior repaint. Your deposit invoice is ready so we can secure your production schedule.', 'View and pay invoice', `https://crewmodo.com/portal/demo-robert-portal-token?invoiceId=${robertDepositInvoice.id}`),
      renderedText: `Your deposit invoice is ready: https://crewmodo.com/portal/demo-robert-portal-token?invoiceId=${robertDepositInvoice.id}`,
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'demo-email-robert-deposit',
      sentBy: owner.id,
      sentAt: daysAgo(14),
      createdAt: daysAgo(14),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      jobId: robertJob.id,
      changeOrderId: garageDoorChangeOrder.id,
      templateKey: 'change_order.approval.sent',
      templateName: 'Change order approval request',
      toEmail: 'robert.chen@example.com',
      fromEmail: 'hello@goldenbrush.example',
      replyTo: 'hello@goldenbrush.example',
      subject: 'Change order CO-1 needs approval',
      previewText: 'Review and approve the detached garage side door change order.',
      renderedHtml: emailShell('Change order ready for approval', 'Please review the detached garage side door and jamb change order. Once approved, the amount is added to your project invoice history.', 'Review change order', `https://crewmodo.com/portal/demo-robert-portal-token?changeOrderId=${garageDoorChangeOrder.id}`),
      renderedText: `Review change order: https://crewmodo.com/portal/demo-robert-portal-token?changeOrderId=${garageDoorChangeOrder.id}`,
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'demo-email-robert-co1',
      sentBy: owner.id,
      sentAt: daysAgo(2),
      createdAt: daysAgo(2),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('harper')!.id,
      jobId: harperJob.id,
      templateKey: 'invoice.payment.reminder',
      templateName: 'Invoice payment reminder',
      toEmail: 'ops@harperco.example',
      fromEmail: 'hello@goldenbrush.example',
      replyTo: 'hello@goldenbrush.example',
      subject: 'Reminder: deposit due before your first work day',
      previewText: 'Your office refresh deposit is due before the crew arrives.',
      renderedHtml: emailShell('Deposit reminder', 'Your office refresh is scheduled soon. Please pay the scheduling deposit before the crew arrives.', 'View and pay invoice', `https://crewmodo.com/portal/demo-harper-portal-token?invoiceId=${harperDepositInvoice.id}`),
      renderedText: `Pay invoice: https://crewmodo.com/portal/demo-harper-portal-token?invoiceId=${harperDepositInvoice.id}`,
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'demo-email-harper-reminder',
      sentBy: owner.id,
      sentAt: daysAgo(1),
      createdAt: daysAgo(1),
    },
    {
      orgId: org.id,
      leadId: leadsByKey.get('robert')!.id,
      jobId: robertJob.id,
      templateKey: 'invoice.payment.receipt',
      templateName: 'Payment receipt',
      toEmail: 'robert.chen@example.com',
      fromEmail: 'hello@goldenbrush.example',
      replyTo: 'hello@goldenbrush.example',
      subject: 'Receipt for your deposit payment',
      previewText: 'Receipt for card payment on your exterior repaint deposit.',
      renderedHtml: emailShell('Payment received', `We received your deposit payment of $${dollars(robertDepositTotal)}.`, 'View receipt', `https://crewmodo.com/portal/demo-robert-portal-token?invoiceId=${robertDepositInvoice.id}`),
      renderedText: `Payment received: $${dollars(robertDepositTotal)}`,
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'demo-email-robert-receipt',
      sentBy: owner.id,
      sentAt: daysAgo(13),
      createdAt: daysAgo(13),
    },
  ]);

  await db.insert(activities).values([
    { orgId: org.id, leadId: leadsByKey.get('emily')!.id, userId: owner.id, type: 'follow_up', title: 'Call Emily about site visit availability', notes: 'New inquiry has not booked measurement yet.', status: 'open', dueAt: daysFromNow(0, 15), createdAt: daysAgo(1), updatedAt: daysAgo(1) },
    { orgId: org.id, leadId: leadsByKey.get('jessica')!.id, estimateId: jessicaEstimate.id, userId: owner.id, type: 'estimate_follow_up', title: 'Follow up on sent proposal', notes: 'Customer asked about trim option; ask if she wants it included.', status: 'open', dueAt: daysFromNow(1, 10), createdAt: daysAgo(2), updatedAt: daysAgo(2) },
    { orgId: org.id, leadId: leadsByKey.get('robert')!.id, jobId: robertJob.id, userId: owner.id, type: 'production', title: 'Final walkthrough before final invoice due', notes: 'Confirm fascia touch-ups and gate cleanup.', status: 'open', dueAt: daysFromNow(1, 9), createdAt: daysAgo(1), updatedAt: daysAgo(1) },
    { orgId: org.id, leadId: leadsByKey.get('harper')!.id, jobId: harperJob.id, userId: owner.id, type: 'payment', title: 'Collect deposit before first work day', notes: 'Deposit invoice sent; do not dispatch crew until paid.', status: 'open', dueAt: daysFromNow(1, 12), createdAt: daysAgo(2), updatedAt: daysAgo(2) },
    { orgId: org.id, leadId: leadsByKey.get('thompson')!.id, userId: owner.id, type: 'lost_reason', title: 'Lost: chose lower bid', notes: 'Customer selected a lower-priced competitor. Tag for nurture campaign in 6 months.', status: 'completed', dueAt: daysAgo(19), completedAt: daysAgo(19), metadata: { lostReason: 'price', competitor: 'Bay Area House Painters' }, createdAt: daysAgo(20), updatedAt: daysAgo(19) },
  ]);

  await db.insert(notificationEvents).values([
    { orgId: org.id, type: 'estimate.viewed', title: 'Jessica viewed her proposal', body: 'Jessica Park opened the interior repaint proposal yesterday.', href: `/leads/${leadsByKey.get('jessica')!.id}#customer-estimates`, priority: 'normal', sourceType: 'estimate', sourceId: jessicaEstimate.id, leadId: leadsByKey.get('jessica')!.id, createdAt: daysAgo(1) },
    { orgId: org.id, type: 'invoice.paid', title: 'Deposit paid', body: `Robert Chen paid $${dollars(robertDepositTotal)} by card.`, href: `/invoices/${robertDepositInvoice.id}`, priority: 'high', sourceType: 'invoice', sourceId: robertDepositInvoice.id, leadId: leadsByKey.get('robert')!.id, metadata: { paymentId: robertDepositPayment.id }, createdAt: daysAgo(13) },
    { orgId: org.id, type: 'invoice.due', title: 'Harper deposit due soon', body: 'Office refresh deposit is due before the first work day.', href: `/invoices/${harperDepositInvoice.id}`, priority: 'high', sourceType: 'invoice', sourceId: harperDepositInvoice.id, leadId: leadsByKey.get('harper')!.id, createdAt: daysAgo(1) },
    { orgId: org.id, type: 'time.review_required', title: 'Time entry needs review', body: 'Devon clocked in without selecting a job.', href: '/time', priority: 'high', sourceType: 'time_entry', sourceId: missingJobEntry.id, metadata: { reviewReason: 'missing_job_assignment' }, createdAt: daysAgo(0) },
    { orgId: org.id, type: 'invoice.refunded', title: 'Invoice refunded', body: 'Thompson consultation deposit was refunded by check.', href: `/invoices/${thompsonRefundedInvoice.id}`, priority: 'normal', sourceType: 'invoice', sourceId: thompsonRefundedInvoice.id, leadId: leadsByKey.get('thompson')!.id, metadata: { paymentId: thompsonRefundedPayment.id }, createdAt: daysAgo(19) },
  ]);

  await db.insert(auditLogs).values([
    { orgId: org.id, userId: owner.id, action: 'estimate.sent', entityType: 'estimate', entityId: jessicaEstimate.id, metadata: { leadId: leadsByKey.get('jessica')!.id, total: jessicaEstimate.total }, createdAt: daysAgo(2) },
    { orgId: org.id, action: 'estimate.viewed', entityType: 'estimate', entityId: jessicaEstimate.id, metadata: { leadId: leadsByKey.get('jessica')!.id, actor: 'customer' }, ipAddress: '203.0.113.24', userAgent: 'Demo customer browser', createdAt: daysAgo(1) },
    { orgId: org.id, action: 'estimate.signed', entityType: 'estimate', entityId: robertEstimate.id, metadata: { leadId: leadsByKey.get('robert')!.id, signedName: 'Robert Chen' }, ipAddress: '203.0.113.55', userAgent: 'Demo customer browser', createdAt: daysAgo(14) },
    { orgId: org.id, userId: owner.id, action: 'invoice.created', entityType: 'invoice', entityId: robertDepositInvoice.id, metadata: { invoiceNumber: robertDepositInvoice.invoiceNumber, total: robertDepositInvoice.total }, createdAt: daysAgo(14) },
    { orgId: org.id, userId: owner.id, action: 'invoice.payment_recorded', entityType: 'payment', entityId: robertDepositPayment.id, metadata: { invoiceId: robertDepositInvoice.id, source: 'stripe', amount: robertDepositPayment.amount }, createdAt: daysAgo(13) },
    { orgId: org.id, userId: owner.id, action: 'change_order.approved', entityType: 'change_order', entityId: garageDoorChangeOrder.id, metadata: { jobId: robertJob.id, amount: garageDoorChangeOrder.amount, paymentId: changeOrderPayment.id }, createdAt: daysAgo(1) },
  ]);

  await db.insert(jobCosts).values([
    {
      orgId: org.id,
      jobId: robertJob.id,
      category: 'materials',
      description: 'Sherwin-Williams invoice SW-2026-1044 imported from supplier statement',
      quantity: '1.00',
      unitCost: '1850.00',
      totalCost: '1850.00',
      materialPurchaseId: robertPurchase.id,
      costDate: daysAgo(5),
    },
    {
      orgId: org.id,
      jobId: robertJob.id,
      category: 'other',
      description: 'Customer-approved change order labor and materials',
      quantity: '1.00',
      unitCost: '420.00',
      totalCost: '420.00',
      costDate: daysAgo(1),
    },
  ]);

  await db.insert(supplierInvoiceSenderRules).values([
    { orgId: org.id, supplierKey: 'sherwin-williams', supplierName: 'Sherwin-Williams', senderEmail: 'statements@sherwin.example', autoStage: true, isActive: true },
    { orgId: org.id, supplierKey: 'benjamin-moore', supplierName: 'Benjamin Moore / NorCal Paint Supply', senderEmail: 'billing@norcalpaintsupply.example', autoStage: true, isActive: true },
  ]);
  const [approvedImport, reviewImport, duplicateImport] = await db.insert(supplierInvoiceImports).values([
    {
      orgId: org.id,
      jobId: robertJob.id,
      materialPurchaseId: robertPurchase.id,
      sourceType: 'email_forward',
      status: 'approved',
      supplier: 'Sherwin-Williams',
      invoiceNumber: 'SW-2026-1044',
      invoiceDate: daysAgo(5),
      senderEmail: 'statements@sherwin.example',
      originalFilename: 'SW-2026-1044.pdf',
      documentHash: 'demo-robert-sw-2026-1044',
      rawText: 'Sherwin-Williams invoice SW-2026-1044 Duration Exterior Satin 18 gallons total 1850.00',
      extractedData: { supplier: 'Sherwin-Williams', invoiceNumber: 'SW-2026-1044', invoiceDate: daysAgo(5).toISOString(), total: 1850 },
      extractedItems: [
        { product: 'Duration Exterior Satin', gallons: 18, unitPrice: 62, total: 1116, color: 'SW 7002 Downy' },
        { product: 'Exterior wood primer', gallons: 8, unitPrice: 38, total: 304 },
        { product: 'Masking, caulk, rollers', quantity: 1, unitPrice: 430, total: 430 },
      ],
      totalAmount: '1850.00',
      matchCandidates: [{ jobId: robertJob.id, label: 'Robert Chen Exterior Repaint', confidence: 0.94, reason: 'Address and recent in-progress exterior job match' }],
      matchConfidence: '0.94',
      extractionConfidence: '0.91',
      reviewNotes: 'Approved by office admin after confirming job match.',
      approvedAt: daysAgo(4),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(4),
    },
    {
      orgId: org.id,
      sourceType: 'upload',
      status: 'needs_review',
      supplier: 'Benjamin Moore / NorCal Paint Supply',
      invoiceNumber: 'BM-77820',
      invoiceDate: daysAgo(1),
      senderEmail: 'billing@norcalpaintsupply.example',
      originalFilename: 'BM-77820.pdf',
      documentHash: 'demo-harper-bm-77820',
      rawText: 'NorCal Paint Supply Benjamin Moore Regal Select 9 gallons office refresh Bryant St total 612.40',
      extractedData: { supplier: 'Benjamin Moore / NorCal Paint Supply', invoiceNumber: 'BM-77820', total: 612.4 },
      extractedItems: [
        { product: 'Regal Select Interior Matte', gallons: 9, unitPrice: 48, total: 432, color: 'Chantilly Lace OC-65' },
        { product: 'Sundries', quantity: 1, unitPrice: 180.4, total: 180.4 },
      ],
      totalAmount: '612.40',
      matchCandidates: [{ jobId: harperJob.id, label: 'Harper & Co Office Refresh', confidence: 0.78, reason: 'Bryant St and office refresh terms detected' }],
      matchConfidence: '0.78',
      extractionConfidence: '0.86',
      reviewNotes: 'Needs confirmation before adding to job cost.',
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
    {
      orgId: org.id,
      sourceType: 'email_forward',
      status: 'duplicate',
      supplier: 'Sherwin-Williams',
      invoiceNumber: 'SW-2026-1044',
      invoiceDate: daysAgo(5),
      senderEmail: 'statements@sherwin.example',
      originalFilename: 'SW-2026-1044-copy.pdf',
      documentHash: 'demo-robert-sw-2026-1044',
      rawText: 'Duplicate Sherwin-Williams invoice SW-2026-1044',
      extractedData: { duplicateReason: 'Document hash matched approved import' },
      extractedItems: [],
      totalAmount: '1850.00',
      matchCandidates: [],
      matchConfidence: '0.00',
      extractionConfidence: '0.00',
      reviewNotes: 'Duplicate detected before creating another purchase.',
      createdAt: daysAgo(0),
      updatedAt: daysAgo(0),
    },
  ]).returning();
  await db.update(supplierInvoiceImports)
    .set({ duplicateOfImportId: approvedImport.id })
    .where(and(eq(supplierInvoiceImports.id, duplicateImport.id), eq(supplierInvoiceImports.orgId, org.id)));
  await db.insert(supplierInvoiceImportFeedback).values([
    { orgId: org.id, importId: approvedImport.id, supplierKey: 'sherwin-williams', supplierName: 'Sherwin-Williams', sourceType: 'email_forward', extractionMethod: 'openai_ocr', outcome: 'approved', suggestedJobId: robertJob.id, finalJobId: robertJob.id, matchWasCorrect: true, hadJobSuggestion: true, matchConfidence: '0.94', extractionConfidence: '0.91', itemCount: 3, totalAmount: '1850.00', reviewNotes: 'Good match and line item extraction.' },
    { orgId: org.id, importId: reviewImport.id, supplierKey: 'benjamin-moore', supplierName: 'Benjamin Moore / NorCal Paint Supply', sourceType: 'upload', extractionMethod: 'openai_ocr', outcome: 'needs_review', suggestedJobId: harperJob.id, finalJobId: null, matchWasCorrect: false, hadJobSuggestion: true, matchConfidence: '0.78', extractionConfidence: '0.86', itemCount: 2, totalAmount: '612.40', reviewNotes: 'Waiting for user approval.' },
  ]);
  await db.insert(supplierInvoiceLearningStats).values([
    { orgId: org.id, supplierKey: 'sherwin-williams', supplierName: 'Sherwin-Williams', sourceType: 'email_forward', extractionMethod: 'openai_ocr', approvedCount: 8, rejectedCount: 1, correctedJobCount: 1, noJobApprovalCount: 0, avgMatchConfidence: '0.88', avgExtractionConfidence: '0.92', hints: { invoiceNumberLabel: 'SALES NUMBER', itemColumns: ['PRODUCT', 'DESCRIPTION', 'QTY', 'PRICE', 'VALUE'] }, lastApprovedAt: daysAgo(4), lastSeenAt: daysAgo(0) },
    { orgId: org.id, supplierKey: 'benjamin-moore', supplierName: 'Benjamin Moore / NorCal Paint Supply', sourceType: 'upload', extractionMethod: 'openai_ocr', approvedCount: 3, rejectedCount: 0, correctedJobCount: 1, noJobApprovalCount: 0, avgMatchConfidence: '0.72', avgExtractionConfidence: '0.84', hints: { commonAddressField: 'ship to', needsHumanReviewBelow: 0.8 }, lastApprovedAt: daysAgo(8), lastSeenAt: daysAgo(1) },
  ]);
  await db.insert(aiUsageEvents).values([
    { orgId: org.id, userId: owner.id, feature: 'supplier_invoice_ocr', provider: 'openai', model: 'gpt-4.1-mini', entityType: 'supplier_invoice_import', entityId: approvedImport.id, inputTokens: 1840, outputTokens: 420, totalTokens: 2260, estimatedCostUsd: '0.003850', metadata: { supplier: 'Sherwin-Williams', documentHash: 'demo-robert-sw-2026-1044' }, createdAt: daysAgo(5) },
    { orgId: org.id, userId: owner.id, feature: 'supplier_invoice_ocr', provider: 'openai', model: 'gpt-4.1-mini', entityType: 'supplier_invoice_import', entityId: reviewImport.id, inputTokens: 1420, outputTokens: 390, totalTokens: 1810, estimatedCostUsd: '0.003050', metadata: { supplier: 'Benjamin Moore / NorCal Paint Supply', documentHash: 'demo-harper-bm-77820' }, createdAt: daysAgo(1) },
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
      invoices: 5,
      payments: 3,
      emailSends: 5,
      supplierInvoiceImports: 3,
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
