import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { reviewRequests, jobs, leads, orgSettings } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendEmail } from '../lib/email';
import { sendSMS } from '../lib/twilio';

const reviews = new Hono<{ Bindings: Env; Variables: Variables }>();

reviews.use('/request', authMiddleware);
reviews.use('/pending', authMiddleware);
reviews.use('/stats', authMiddleware);

const reviewRatingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  feedback: z.string().max(5000).optional(),
});

// POST /v1/reviews/request
reviews.post('/request', async (c) => {
  const orgId = c.get('orgId');
  const { jobId } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  
  if (!job || job.orgId !== orgId) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, job.leadId) });
  if (!lead) return c.json({ error: 'Lead not found' }, 404);
  
  // Create review request
  const [request] = await db.insert(reviewRequests).values({
    orgId,
    jobId,
    leadId: lead.id,
    status: 'pending',
  }).returning();
  
  const reviewUrl = `${c.env.PUBLIC_URL}/review/${request.id}`;
  
  await db.update(reviewRequests)
    .set({ reviewUrl, sentAt: new Date(), status: 'sent' })
    .where(eq(reviewRequests.id, request.id));
  
  // Send SMS if phone exists
  if (lead.phone) {
    try {
      await sendSMS(c.env, lead.phone, 
        `Hi ${lead.name}! How did we do on your painting project? Please take 30 seconds to rate us: ${reviewUrl}`
      );
    } catch (err) {
      console.error('Failed to send review SMS:', err);
    }
  }
  
  // Send email if email exists
  if (lead.email) {
    try {
      const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2563eb;">How did we do?</h1>
  <p>Hi ${lead.name},</p>
  <p>Thank you for choosing us for your painting project! We'd love to hear your feedback.</p>
  <p>Please take 30 seconds to rate your experience:</p>
  <a href="${reviewUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Rate Your Experience</a>
  <p>Your feedback helps us improve and helps other homeowners find us.</p>
  <p>Thank you!</p>
</body>
</html>
      `;
      await sendEmail(c.env, lead.email, 'How did we do?', html);
    } catch (err) {
      console.error('Failed to send review email:', err);
    }
  }
  
  return c.json({ success: true, reviewUrl });
});

// POST /v1/reviews/:id/rate (public, no auth)
reviews.post('/:id/rate', async (c) => {
  const id = c.req.param('id');
  const parsed = reviewRatingSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const { rating, feedback } = parsed.data;
  
  const db = createDb(c.env.DATABASE_URL);
  const request = await db.query.reviewRequests.findFirst({
    where: eq(reviewRequests.id, id),
  });
  
  if (!request) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  await db.update(reviewRequests)
    .set({
      rating: rating.toString(),
      status: rating >= 4 ? 'redirected_to_google' : 'feedback_collected',
      respondedAt: new Date(),
    })
    .where(eq(reviewRequests.id, id));

  const settings = rating >= 4
    ? await db.query.orgSettings.findFirst({
      where: eq(orgSettings.orgId, request.orgId),
    })
    : null;
  
  // Store feedback separately if needed
  if (feedback && rating < 4) {
    // Could insert into a feedback table or log
    console.log(`Feedback for request ${id}:`, feedback);
  }
  
  return c.json({
    success: true,
    redirect: rating >= 4,
    reviewUrl: settings?.googleReviewUrl || settings?.yelpReviewUrl || null,
  });
});

// GET /v1/reviews/pending
reviews.get('/pending', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const requests = await db
    .select()
    .from(reviewRequests)
    .where(and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.status, 'pending')));

  return c.json({ data: requests });
});

// GET /v1/reviews/stats
reviews.get('/stats', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const requests = await db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.orgId, orgId));
  
  const total = requests.length;
  const responded = requests.filter(r => r.rating).length;
  const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;
  const avgRating = responded > 0 ? requests.filter(r => r.rating).reduce((sum, r) => sum + parseFloat(r.rating || '0'), 0) / responded : 0;
  const fiveStar = requests.filter(r => r.rating === '5').length;
  
  // Get lead/job names
  const requestsWithNames = await Promise.all(requests.slice(0, 20).map(async req => {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, req.leadId) });
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, req.jobId) });
    return {
      ...req,
      leadName: lead?.name,
      leadStreetAddress: lead?.streetAddress,
      leadCity: lead?.city,
      leadState: lead?.state,
      leadPostalCode: lead?.postalCode,
      jobName: job?.name,
    };
  }));
  
  return c.json({
    data: {
      total,
      responseRate,
      avgRating,
      fiveStar,
      requests: requestsWithNames,
    }
  });
});

export default reviews;
