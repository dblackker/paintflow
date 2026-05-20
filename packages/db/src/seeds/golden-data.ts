export const goldenSeed = {
  organization: {
    name: 'Golden Brush Painting',
    slug: 'golden-brush-demo',
  },
  owner: {
    name: 'Daniel Demo',
    email: 'demo@goldenbrush.paintflow.local',
  },
  settings: {
    companyName: 'Golden Brush Painting',
    phone: '+14155550120',
    email: 'hello@goldenbrush.example',
    address: '1800 Mission St, San Francisco, CA 94103',
    website: 'https://goldenbrush.example',
    defaultLaborRate: '68.00',
    materialMarkupPercent: '32.00',
    salesTaxRate: '0.0863',
    depositPercent: '40.00',
    estimateValidDays: 21,
    paymentTerms: '40% deposit, progress payment after prep, balance due on completion',
    acceptChecks: true,
    acceptCash: false,
    googleReviewUrl: 'https://example.com/golden-brush-reviews',
    onboardingCompletedAt: new Date('2026-05-01T16:00:00Z'),
  },
  branding: {
    companyName: 'Golden Brush Painting',
    logoUrl: 'https://dummyimage.com/320x120/176b5b/ffffff.png&text=Golden+Brush',
    primaryColor: '#176b5b',
  },
  serviceAreas: [
    { zipCode: '94103', city: 'San Francisco', state: 'CA' },
    { zipCode: '94107', city: 'San Francisco', state: 'CA' },
    { zipCode: '94010', city: 'Burlingame', state: 'CA' },
    { zipCode: '94402', city: 'San Mateo', state: 'CA' },
  ],
  leadSources: [
    { name: 'Website form', type: 'website', cost: '475.00' },
    { name: 'Google Local Services', type: 'google_ads', cost: '1250.00' },
    { name: 'Customer referral', type: 'referral', cost: '150.00' },
    { name: 'Yard sign', type: 'offline', cost: '85.00' },
  ],
  roles: [
    { name: 'Owner', permissions: ['all'], isSystem: true },
    { name: 'Office Admin', permissions: ['manage_leads', 'manage_estimates', 'manage_team', 'view_reports', 'view_all_time'], isSystem: true },
    { name: 'Crew Lead', permissions: ['view_jobs', 'log_time_for_others'], isSystem: true },
    { name: 'Painter', permissions: ['view_jobs', 'log_own_time'], isSystem: true },
  ],
  teamMembers: [
    { key: 'nick', name: 'Nick Martinez', email: 'nick@goldenbrush.example', role: 'crew_lead', hourlyRate: '34.00', burdenRate: '38.00' },
    { key: 'maria', name: 'Maria Sanchez', email: 'maria@goldenbrush.example', role: 'painter', hourlyRate: '29.00', burdenRate: '34.00' },
    { key: 'devon', name: 'Devon Lee', email: 'devon@goldenbrush.example', role: 'painter', hourlyRate: '26.50', burdenRate: '32.00' },
    { key: 'sam', name: 'Sam Patel', email: 'sam@goldenbrush.example', role: 'prep', hourlyRate: '23.00', burdenRate: '30.00' },
  ],
  productionRates: [
    { key: 'walls', category: 'interior', surfaceType: 'walls', unit: 'sqft', ratePerHour: '390.00', hourlyRate: '68.00', prepMultiplier: '1.00', coats: 2, description: 'Interior walls, brush and roll' },
    { key: 'ceilings', category: 'interior', surfaceType: 'ceilings', unit: 'sqft', ratePerHour: '285.00', hourlyRate: '68.00', prepMultiplier: '1.10', coats: 2, description: 'Flat ceilings' },
    { key: 'trim', category: 'interior', surfaceType: 'trim', unit: 'linear_ft', ratePerHour: '78.00', hourlyRate: '72.00', prepMultiplier: '1.20', coats: 2, description: 'Baseboards, casing, and crown trim' },
    { key: 'doors', category: 'interior', surfaceType: 'doors', unit: 'each', ratePerHour: '4.00', hourlyRate: '72.00', prepMultiplier: '1.15', coats: 2, description: 'Interior slab door, both sides' },
    { key: 'siding', category: 'exterior', surfaceType: 'siding', unit: 'sqft', ratePerHour: '210.00', hourlyRate: '76.00', prepMultiplier: '1.25', coats: 2, description: 'Exterior siding, spray and back-roll' },
    { key: 'soffits', category: 'exterior', surfaceType: 'soffits', unit: 'sqft', ratePerHour: '120.00', hourlyRate: '76.00', prepMultiplier: '1.15', coats: 2, description: 'Exterior soffits' },
    { key: 'fascia', category: 'exterior', surfaceType: 'fascia', unit: 'linear_ft', ratePerHour: '52.00', hourlyRate: '76.00', prepMultiplier: '1.20', coats: 2, description: 'Exterior fascia boards' },
  ],
  materials: [
    { key: 'wallPaint', name: 'Regal Select Interior Matte', category: 'paint', brand: 'Benjamin Moore', unit: 'gallon', costPerUnit: '48.00', markupPercent: '32.00', coverageSqFt: '380.00', supplier: 'NorCal Paint Supply', sku: 'BM-REG-MATTE' },
    { key: 'trimPaint', name: 'ProClassic Waterborne Semi-Gloss', category: 'paint', brand: 'Sherwin-Williams', unit: 'gallon', costPerUnit: '56.00', markupPercent: '32.00', coverageSqFt: '350.00', supplier: 'Sherwin-Williams', sku: 'SW-PROCLASSIC-SG' },
    { key: 'exteriorPaint', name: 'Duration Exterior Satin', category: 'paint', brand: 'Sherwin-Williams', unit: 'gallon', costPerUnit: '62.00', markupPercent: '35.00', coverageSqFt: '300.00', supplier: 'Sherwin-Williams', sku: 'SW-DURATION-SAT' },
    { key: 'primer', name: 'Multi-Purpose Interior/Exterior Primer', category: 'primer', brand: 'Zinsser', unit: 'gallon', costPerUnit: '31.00', markupPercent: '30.00', coverageSqFt: '325.00', supplier: 'NorCal Paint Supply', sku: 'ZIN-MP-PRIMER' },
    { key: 'sundries', name: 'Tape, plastic, caulk, rollers', category: 'supplies', brand: 'Mixed', unit: 'each', costPerUnit: '185.00', markupPercent: '25.00', supplier: 'Warehouse stock', sku: 'SUNDRIES-JOB' },
  ],
  leads: [
    { key: 'jessica', name: 'Jessica Park', phone: '+14155550101', email: 'jessica.park@example.com', streetAddress: '742 Noe St', city: 'San Francisco', state: 'CA', postalCode: '94114', source: 'Website form', status: 'estimate_sent' },
    { key: 'robert', name: 'Robert Chen', phone: '+14155550102', email: 'robert.chen@example.com', streetAddress: '1818 Lake St', city: 'San Francisco', state: 'CA', postalCode: '94121', source: 'Google Local Services', status: 'won' },
    { key: 'emily', name: 'Emily Rivera', phone: '+14155550103', email: 'emily.rivera@example.com', streetAddress: '95 South Park St', city: 'San Francisco', state: 'CA', postalCode: '94107', source: 'Customer referral', status: 'new' },
    { key: 'harper', name: 'Harper & Co Workspace', phone: '+14155550104', email: 'ops@harperco.example', streetAddress: '420 Bryant St', city: 'San Francisco', state: 'CA', postalCode: '94107', source: 'Website form', status: 'contacted' },
    { key: 'thompson', name: 'Thompson Residence', phone: '+14155550105', email: 'thompson@example.com', streetAddress: '1120 Ralston Ave', city: 'Burlingame', state: 'CA', postalCode: '94010', source: 'Yard sign', status: 'lost' },
  ],
  messages: [
    { leadKey: 'jessica', direction: 'outbound', fromNumber: '+14155550120', toNumber: '+14155550101', body: 'Hi Jessica, your painting proposal is ready. Reply with any color questions before Friday.' },
    { leadKey: 'jessica', direction: 'inbound', fromNumber: '+14155550101', toNumber: '+14155550120', body: 'Thanks, can you include the stairwell trim as an option?' },
    { leadKey: 'emily', direction: 'outbound', fromNumber: '+14155550120', toNumber: '+14155550103', body: 'Thanks for reaching out. We can visit Thursday afternoon for measurements.' },
  ],
  estimateTemplates: [
    {
      name: '3 Bedroom Interior Repaint',
      description: 'Common interior repaint template with walls, ceilings, trim, and doors.',
      category: 'room',
      isShared: true,
      isSmart: true,
      usageCount: 8,
      rooms: [
        { name: 'Bedroom', roomType: 'bedroom', items: [{ category: 'walls', quantity: 420 }, { category: 'trim', quantity: 68 }] },
        { name: 'Hallway', roomType: 'hallway', items: [{ category: 'walls', quantity: 260 }, { category: 'ceilings', quantity: 120 }] },
      ],
    },
  ],
  messageTemplates: [
    { type: 'estimate_followup_1', channel: 'sms', body: 'Hi {{customerName}}, just checking in on your PaintFlow estimate. Any questions before we hold the schedule?', enabled: true, delayDays: 2 },
    { type: 'review_request', channel: 'email', subject: 'How did your painting project go?', body: 'Thanks for choosing Golden Brush Painting. Would you leave us a quick review?', enabled: true, delayDays: 1 },
  ],
} as const;

export type GoldenSeed = typeof goldenSeed;
