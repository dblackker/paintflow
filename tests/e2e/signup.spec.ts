import { expect, test } from '@playwright/test';

const signupUrlPattern = /\/v1\/auth\/signup$/;

async function fillSignupForm(page: import('@playwright/test').Page, email: string) {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Start your contractor workspace' })).toBeVisible();
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Company name').fill('Morgan Contracting Co.');
  await page.getByLabel('Phone number').fill('+1 (415) 555-0199');
}

test.describe('trial signup', () => {
  test('surfaces branded required-field errors instead of native validation', async ({ page }) => {
    let signupRequested = false;
    await page.route(signupUrlPattern, async (route) => {
      signupRequested = true;
      await route.abort();
    });

    await page.goto('/signup');
    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();
    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();

    await expect(page.getByText('Your name is required.')).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#signup-name-error')).toHaveCount(1);
    await expect(page.getByLabel('Your name')).toHaveAttribute('aria-describedby', 'signup-name-error');
    expect(signupRequested).toBe(false);
  });

  test('explains checkout handoff and redirects to Stripe checkout', async ({ page }) => {
    await page.route(signupUrlPattern, async (route, request) => {
      const headers = request.headers();
      expect(headers['idempotency-key']).toBeTruthy();
      const body = request.postDataJSON();
      expect(body.email).toBe('alex@example.com');
      expect(body.companyName).toBe('Morgan Contracting Co.');
      expect(body.phone).toBe('(415) 555-0199');
      expect(body.plan).toBe('pro');

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          checkoutUrl: '/stripe-checkout/session_123',
          trialDays: 14,
          plan: 'pro',
        }),
      });
    });

    await fillSignupForm(page, 'alex@example.com');

    await expect(page.getByText('No magic link is required during signup.')).toBeVisible();
    await expect(page.getByText('You return to Crewmodo signed in.')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();

    await expect(page).toHaveURL(/\/stripe-checkout\/session_123$/);
  });

  test('shows a resumable checkout message after cancellation', async ({ page }) => {
    await page.goto('/signup?checkout=canceled&plan=pro');

    await expect(page.getByText('Your workspace is saved, but the trial is not active yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to secure checkout' })).toBeVisible();
  });

  test('resumes pending signup checkout for an existing trial-pending account', async ({ page }) => {
    await page.route(signupUrlPattern, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          resumedSignup: true,
          checkoutUrl: '/stripe-checkout/resume_123',
          trialDays: 14,
          plan: 'pro',
        }),
      });
    });

    await fillSignupForm(page, 'pending@example.com');
    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();

    await expect(page).toHaveURL(/\/stripe-checkout\/resume_123$/);
  });

  test('directs existing workspace owners to check email for a one-time link', async ({ page }) => {
    await page.route(signupUrlPattern, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          existingAccount: true,
          message: 'If this email already has a workspace, a one-time sign-in link will be sent.',
        }),
      });
    });

    await fillSignupForm(page, 'owner@example.com');
    await page.getByRole('button', { name: 'Continue to secure checkout' }).click();

    await expect(page.getByText('That email is already tied to a Crewmodo workspace')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue setup' })).toHaveAttribute('href', '/login');
    await expect(page).toHaveURL(/\/signup$/);
  });
});
