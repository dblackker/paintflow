# Pipeline Automation Plan

Crewmodo now derives a customer pipeline from leads, estimates, jobs, and open activities. The next production step is to make stage changes and follow-up creation deliberate, auditable, and eventually automated.

## Current Lifecycle

The `/pipeline` view groups customers into these operational stages:

- New lead
- Contacted
- Estimate scheduled
- Estimate in progress
- Estimate sent
- Won / deposit pending
- Ready to schedule
- Scheduled
- In production
- Punch list
- Completed / review requested
- Lost / archived

For now the API derives the stage from existing records:

- Lead status drives the early sales stages.
- Draft, sent, accepted, and declined estimates move the customer through estimating and closeout.
- Jobs move accepted work through scheduling, production, and completion.
- Open activities provide the next action and warning state.

This keeps the board useful without forcing a data migration into every existing record.

## Activities Table

Activities are the durable follow-up and task layer. They can be attached to a customer, estimate, or job and support these types:

- Call
- Text
- Email
- Site visit
- Follow-up
- Task
- Note
- Schedule
- Production
- Payment
- Review

Statuses are intentionally simple: open, done, skipped. This keeps mobile crew and owner workflows fast while still supporting reporting.

## Automation Rules

Recommended first automation rules:

- New lead created: create an open activity due in 15 minutes titled "Call new lead".
- Lead contacted with no estimate after 24 hours: create "Schedule estimate walkthrough".
- Estimate draft older than 48 hours: create "Finish estimate draft".
- Estimate sent and not accepted after 2 days: create "Follow up on estimate".
- Estimate sent and not accepted after 7 days: create "Second follow-up on estimate".
- Estimate accepted with no job after 24 hours: create "Schedule production handoff".
- Job scheduled without photos or material list 48 hours before start: create "Confirm colors, products, and prep notes".
- Job marked completed: create "Send review request and select before/after photos".
- Inbound SMS received: create or surface a high-priority notification if unread.

## Implementation Strategy

Use a scheduled worker that runs every 15 minutes and scans tenant records with explicit `org_id` filters. It should write activities and notification events idempotently using metadata keys such as:

```json
{
  "automationKey": "estimate_sent_followup_2d",
  "sourceType": "estimate",
  "sourceId": "..."
}
```

Before inserting an automated activity, check for an existing open or completed activity with the same automation key and source. This prevents duplicate task creation when the scheduled worker retries.

## Stage Persistence

The current derived stage model is safe for the first production pass. Persisted pipeline stages should be added later when owners need manual overrides such as "waiting on customer", "insurance hold", or "seasonal callback".

Recommended future table:

- `pipeline_stage_events`: org, lead, previous stage, next stage, reason, user, created date.
- Optional `leads.pipeline_stage_override`: nullable stage id for deliberate manual control.

The UI should continue to show the derived stage when no override is present.

## Notifications

Activities due today or overdue should appear in the notification center. High-priority triggers should also use the PWA push path when VAPID and push subscriptions are configured.

Recommended notification priorities:

- High: inbound customer message, accepted estimate, overdue follow-up, job handoff blocker.
- Normal: activity due today, estimate viewed, review requested.
- Low: automation summaries and non-urgent operational reminders.

## Analytics

User-facing actions should emit PostHog events once the analytics client is wired consistently across the app:

- `pipeline_viewed`
- `pipeline_filter_changed`
- `activity_created`
- `activity_completed`
- `pipeline_card_opened`
- `automation_activity_created`

The useful owner-level metrics are time in stage, estimate follow-up latency, lead-to-estimate conversion, estimate acceptance rate, accepted-to-scheduled delay, and production closeout delay.
