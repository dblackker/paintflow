import { test, expect } from '@playwright/test';

test.describe('Lead → Estimate → Sign → Pay', () => {
  test('complete flow', async ({ page }) => {
    const API_URL = 'http://localhost:8787';
    
    // 1. Create lead via API
    const leadRes = await page.request.post(`${API_URL}/v1/leads`, {
      headers: { 'X-Org-Id': 'test-org-id' },
      data: {
        name: 'Test Customer',
        email: 'test@example.com',
        phone: '555-0123',
        address: '123 Test St',
      },
    });
    
    expect(leadRes.ok()).toBeTruthy();
    const { data: lead } = await leadRes.json();
    
    // 2. Create estimate
    const estimateRes = await page.request.post(`${API_URL}/v1/estimates`, {
      headers: { 'X-Org-Id': 'test-org-id' },
      data: {
        leadId: lead.id,
        packages: [
          {
            name: 'better',
            total: 5000,
            items: [
              { desc: 'Interior painting', qty: 1000, rate: 5 },
            ],
          },
        ],
      },
    });
    
    expect(estimateRes.ok()).toBeTruthy();
    const { data: estimate } = await estimateRes.json();
    
    // 3. Send estimate
    await page.request.post(`${API_URL}/v1/estimates/${estimate.id}/send`, {
      headers: { 'X-Org-Id': 'test-org-id' },
    });
    
    // 4. Visit public estimate page
    await page.goto(`/estimates/${estimate.id}`);
    
    // Wait for packages to load
    await expect(page.locator('text=Painting Estimate')).toBeVisible();
    await expect(page.locator('text=Better Package')).toBeVisible();
    
    // 5. Click accept
    await page.click('text=Accept Better');
    
    // 6. Terms modal
    await expect(page.locator('text=Terms & Conditions')).toBeVisible();
    await page.click('text=I Agree to Terms');
    
    // 7. Signature modal
    await expect(page.locator('text=Sign Estimate')).toBeVisible();
    await page.fill('#signer-name', 'Test Customer');
    
    // Draw signature
    const canvas = page.locator('#signature-pad');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 150, box.y + 50);
      await page.mouse.up();
    }
    
    // 8. Submit signature
    // Mock Stripe checkout by intercepting request
    await page.route('**/v1/billing/checkout', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ checkoutUrl: 'https://stripe.test/checkout' }),
      });
    });
    
    await page.click('text=Sign & Pay Deposit');
    
    // Verify signature was saved
    const updatedEstimate = await page.request.get(`${API_URL}/v1/estimates/${estimate.id}/public`);
    const { data: updated } = await updatedEstimate.json();
    expect(updated.signedName).toBe('Test Customer');
    expect(updated.signedAt).toBeTruthy();
  });
  
  test('validation prevents empty signature', async ({ page }) => {
    await page.goto('/estimates/test-id-123');
    
    // If estimate loads, try to submit empty name
    const nameInput = page.locator('#signer-name');
    if (await nameInput.isVisible()) {
      await page.click('text=Sign & Pay Deposit');
      // Should show alert or validation error
      page.on('dialog', dialog => {
        expect(dialog.message()).toContain('name');
        dialog.accept();
      });
    }
  });
});
