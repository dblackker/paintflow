import { createDb } from '@paintflow/db';
import { estimates, leads } from '@paintflow/db/schema';
import { eq, and, lte } from 'drizzle-orm';

// Drip schedule: Day 1, 3, 7 after estimate sent
const DRIP_SCHEDULE = [1, 3, 7];

export async function processDrips(env: any) {
  const db = createDb(env.DATABASE_URL);
  
  // Find estimates sent but not accepted, where next drip is due
  const now = new Date();
  
  const sentEstimates = await db
    .select()
    .from(estimates)
    .where(eq(estimates.status, 'sent'));
  
  for (const estimate of sentEstimates) {
    if (!estimate.sentAt) continue;
    
    const daysSinceSent = Math.floor(
      (now.getTime() - estimate.sentAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // Check if we should send a drip today
    if (DRIP_SCHEDULE.includes(daysSinceSent)) {
      // Check if already sent for this day
      const dripKey = `drip:${estimate.id}:day${daysSinceSent}`;
      const alreadySent = await env.KV.get(dripKey);
      
      if (!alreadySent) {
        await sendDripMessage(env, estimate, daysSinceSent);
        await env.KV.put(dripKey, 'sent', { expirationTtl: 86400 * 30 });
      }
    }
  }
}

async function sendDripMessage(env: any, estimate: any, day: number) {
  // Fetch lead details
  const db = createDb(env.DATABASE_URL);
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  if (!lead?.phone) return;
  
  const messages = {
    1: `Hi ${lead.name}, just checking if you had a chance to review the estimate I sent yesterday. Happy to answer any questions!`,
    3: `Hi ${lead.name}, following up on the estimate. I have availability next week if you'd like to lock in your spot.`,
    7: `Hi ${lead.name}, last check-in on the estimate. Let me know if you're still interested or if the timing isn't right now.`,
  };
  
  const message = messages[day as keyof typeof messages];
  
  // TODO: Send via Twilio
  // await env.TWILIO.send({ to: lead.phone, body: message });
  
  console.log(`DRIP Day ${day} to ${lead.phone}: ${message}`);
  
  // Log activity
  await db.insert({/* activities table */} as any);
}
