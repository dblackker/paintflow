import { createDb } from '@crewmodo/db';
import { jobs, reviewRequests, leads, orgBranding } from '@crewmodo/db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { sendSMS } from '../lib/twilio';
import { sendEmail } from '../lib/email';

export async function processReviewRequests(env: any) {
  const db = createDb(env.DATABASE_URL);
  let sent = 0;
  let skipped = 0;
  
  // Find jobs completed 24 hours ago with no review request sent
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const completedJobs = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'completed'),
        lte(jobs.completedAt, twentyFourHoursAgo)
      )
    );
  
  for (const job of completedJobs) {
    // Check if review request already exists
    const existing = await db.query.reviewRequests.findFirst({
      where: eq(reviewRequests.jobId, job.id),
    });
    
    if (existing) {
      skipped++;
      continue;
    }
    
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, job.leadId),
    });
    
    if (!lead) {
      skipped++;
      continue;
    }
    
    // Create review request
    const [request] = await db.insert(reviewRequests).values({
      orgId: job.orgId,
      jobId: job.id,
      leadId: lead.id,
      status: 'pending',
    }).returning();
    
    const reviewUrl = `${env.PUBLIC_URL}/review/${request.id}`;
    
    await db.update(reviewRequests)
      .set({ reviewUrl, sentAt: new Date(), status: 'sent' })
      .where(eq(reviewRequests.id, request.id));
    
    // Get org branding for personalization
    const branding = await db.query.orgBranding.findFirst({
      where: eq(orgBranding.orgId, job.orgId),
    });
    
    const companyName = branding?.companyName || 'our team';
    
    // Send SMS
    if (lead.phone) {
      try {
        await sendSMS(env, lead.phone,
          `Hi ${lead.name}! ${companyName} here. How did we do on your painting project? Please take 30 seconds to rate us: ${reviewUrl}`
        );
      } catch (err) {
        console.error('Failed to send review SMS:', err);
      }
    }
    
    // Send email
    if (lead.email) {
      try {
        const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2563eb;">How did we do?</h1>
  <p>Hi ${lead.name},</p>
  <p>Thank you for choosing ${companyName} for your painting project! We'd love to hear your feedback.</p>
  <p>Please take 30 seconds to rate your experience:</p>
  <a href="${reviewUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Rate Your Experience</a>
  <p>Your feedback helps us improve and helps other homeowners find us.</p>
  <p>Thank you!</p>
  <p>The ${companyName} Team</p>
</body>
</html>
        `;
        await sendEmail(env, lead.email, 'How did we do?', html);
      } catch (err) {
        console.error('Failed to send review email:', err);
      }
    }
    
    console.log(`Review request sent for job ${job.id} to ${lead.name}`);
    sent++;
  }

  return { processed: completedJobs.length, sent, skipped };
}
