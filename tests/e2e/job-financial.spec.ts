import assert from "node:assert/strict";
import { test } from "@playwright/test";
import { jobFinancialPosition } from "../../packages/core/src/job-financial-position.ts";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const legacyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";
const summary = jobFinancialPosition({
  estimate: {
    status: "accepted",
    packages: [
      { name: "proposal", total: "1092", tax: "92", subtotal: "1000" },
    ],
  },
  acceptance: { packageName: "proposal", selectedOptions: [] },
  approvedChanges: "0",
  recordedCost: "200",
  costRecordCount: 2,
  positiveCostCount: 2,
  unreviewedTimeCount: 0,
  estimatedMaterials: null,
  asOf: "2026-10-03T12:00:00Z",
});
const job = {
  id: jobId,
  name: "Interior repaint - long customer and jobsite name",
  status: "completed",
  jobNumber: "JOB-1001",
  estimateId: "e1",
  leadId: "l1",
  leadName: "Alexandria Long Customer Name",
  streetAddress: "123 Jobsite Street",
  city: "Bremerton",
  state: "WA",
  leadStreetAddress: "Different billing address",
  scheduledStartAt: "2026-10-01T12:00:00Z",
  scheduledEndAt: "2026-10-02T12:00:00Z",
};
const production = { laborHours: 2, averageLaborRate: 50 };
const legacySummary = jobFinancialPosition({
  estimate: null,
  acceptance: null,
  approvedChanges: "0",
  recordedCost: "0",
  costRecordCount: 0,
  positiveCostCount: 0,
  unreviewedTimeCount: 0,
  estimatedMaterials: null,
  asOf: summary.asOf,
});
const detail = {
  job,
  financialSummary: summary,
  revenue: { contract: 1000, approvedChangeOrders: 0, total: 1000 },
  costs: { labor: 100, materials: 100, supplies: 0, expenses: 0, total: 200 },
  production,
  budget: {
    estimatedMaterials: null,
    materialVariance: null,
    remainingGrossProfit: 800,
  },
  profitability: { grossProfit: 800, grossMargin: 80, costToRevenue: 20 },
  lists: {
    costs: [
      {
        id: "c1",
        category: "labor",
        description: "Recorded labor",
        quantity: 2,
        unitCost: 50,
        totalCost: 100,
      },
      {
        id: "c2",
        category: "materials",
        description: "Paint purchase",
        quantity: 1,
        unitCost: 100,
        totalCost: 100,
      },
    ],
    changeOrders: [],
    materialPurchases: [],
  },
};

test(
  "jobs mobile/desktop: one list request, consistent money, unknown costs, menu/time/CO/photo flows preserved",
  async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const baseUrl = baseURL!;
    try {
      const page = await browser.newPage({ serviceWorkers: "block" });
      const errors: string[] = [];
      let listCostingRequests = 0;
      let onList = true;
      let listHasMore = false;
      let cursorRequests = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://**/*", (route) => route.abort());
      await page.route("**/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (onList && path.endsWith("/costing")) listCostingRequests++;
        let data: unknown = [];
        if (path === "/v1/jobs")
          data = [
            { ...job, financialSummary: summary, costing: { production } },
            {
              ...job,
              id: legacyId,
              name: "Legacy job without costs",
              estimateId: null,
              financialSummary: legacySummary,
              costing: { production: { laborHours: 0 } },
            },
          ];
        if (path.endsWith("/costing")) data = detail;
        if (path === `/v1/jobs/${legacyId}/costing`)
          data = {
            ...detail,
            job: { ...job, id: legacyId, estimateId: null },
            financialSummary: legacySummary,
            revenue: { contract: null, approvedChangeOrders: 0, total: null },
            costs: {
              labor: 0,
              materials: 0,
              supplies: 0,
              expenses: 0,
              total: 0,
            },
            profitability: {
              grossProfit: null,
              grossMargin: null,
              costToRevenue: null,
            },
            lists: { costs: [], changeOrders: [], materialPurchases: [] },
          };
        if (path === "/v1/team/members")
          data = [
            {
              id: "m1",
              name: "Devon Painter",
              role: "painter",
              isActive: true,
              hourlyRate: 25,
            },
          ];
        if (path === "/v1/team/time")
          data = [
            {
              id: "t1",
              teamMemberId: "m1",
              teamMemberName: "Devon Painter",
              jobId,
              hours: 2,
              totalCost: 100,
              hourlyRate: 50,
              date: "2026-10-03",
            },
          ];
        if (path === `/v1/uploads/photos/${jobId}`) data = [];
        const headers = {
          "access-control-allow-origin": new URL(baseUrl!).origin,
          "access-control-allow-credentials": "true",
        };
        if (
          path === "/v1/jobs" &&
          new URL(route.request().url()).searchParams.has("cursor")
        ) {
          cursorRequests++;
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (cursorRequests === 1) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              headers,
              body: JSON.stringify({ error: "More jobs unavailable. Retry." }),
            });
            return;
          }
          data = [
            {
              ...job,
              id: "j3",
              name: "Additional paginated job",
              financialSummary: summary,
              costing: { production },
            },
          ];
        }
        await route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            data,
            nextCursor:
              path === "/v1/jobs" &&
              listHasMore &&
              !new URL(route.request().url()).searchParams.has("cursor")
                ? "test-cursor"
                : null,
          }),
        });
      });
      for (const width of [360, 390, 430, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        onList = true;
        await page.goto(`${baseUrl}/jobs`, { waitUntil: "domcontentloaded" });
        await page.getByText("80% recorded margin", { exact: true }).waitFor();
        assert.equal(
          await page.getByText("Margin unavailable", { exact: true }).count(),
          1,
        );
        assert.equal(
          await page
            .getByText("Different billing address", { exact: true })
            .count(),
          0,
        );
        assert.equal(listCostingRequests, 0);
        const listAmounts = await page
          .getByRole("region", { name: "Job financial summary" })
          .first()
          .locator("dd")
          .allTextContents();
        assert.deepEqual(listAmounts, ["$1,000.00", "$200.00", "$800.00"]);
        const overflow = () =>
          page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          );
        assert.equal(await overflow(), false, `List overflow at ${width}`);
        if (width <= 430) {
          const small = await page
            .locator("article button, article a.btn-text")
            .evaluateAll((elements) =>
              elements
                .filter((element) => {
                  const rect = element.getBoundingClientRect();
                  return rect.width < 48 || rect.height < 48;
                })
                .map((element) => element.textContent),
            );
          assert.deepEqual(
            small,
            [],
            "Job card actions must be 48px touch targets",
          );
        }
        await page.screenshot({
          path: testInfo.outputPath(`jobs-list-${width}.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: /^More actions for/ })
          .first()
          .click();
        await page.getByRole("dialog", { name: "Job actions" }).waitFor();
        await page
          .getByRole("button", { name: "Add time", exact: true })
          .click();
        await page.getByRole("dialog", { name: /crew time/i }).waitFor();
        assert.equal(await page.getByRole("dialog").count(), 1);
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        onList = false;
        await page
          .getByRole("link", { name: "View job", exact: true })
          .first()
          .click();
        await page
          .getByText(
            "Work is complete. Cost capture has not been signed off.",
            { exact: true },
          )
          .waitFor();
        const detailAmounts = await page
          .getByRole("region", { name: "Job financial summary" })
          .locator("dd")
          .allTextContents();
        assert.deepEqual(detailAmounts, listAmounts);
        assert.equal(await overflow(), false, `Detail overflow at ${width}`);
        const photo = page.locator('input[name="file"]');
        assert.equal(await photo.getAttribute("accept"), "image/*");
        assert.equal(await photo.getAttribute("capture"), null);
        await page.screenshot({
          path: testInfo.outputPath(`jobs-detail-${width}.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "More job actions", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Job actions" })
          .getByRole("button", { name: "Add change order", exact: true })
          .click();
        await page.getByRole("dialog", { name: /change order/i }).waitFor();
        assert.equal(await page.getByRole("dialog").count(), 1);
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await page
          .getByRole("button", { name: "More job actions", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Job actions" })
          .getByRole("button", { name: "Add cost", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Add Job Cost", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        console.log(
          `Jobs ${width}px: money parity, no overflow, action-sheet/time/CO/cost/photo checks pass`,
        );
      }
      await page.setViewportSize({ width: 360, height: 900 });
      await page.goto(`${baseUrl}/jobs/${legacyId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByText("Margin unavailable", { exact: true }).waitFor();
      assert.deepEqual(
        await page
          .getByRole("region", { name: "Job financial summary" })
          .locator("dd")
          .allTextContents(),
        ["Not available", "$0.00", "Not available"],
      );
      await page
        .getByRole("button", { name: "More job actions", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("dialog", { name: "Job actions" })
          .getByRole("button", { name: "Add change order", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      listHasMore = true;
      onList = true;
      await page.goto(`${baseUrl}/jobs`, { waitUntil: "domcontentloaded" });
      await page
        .getByRole("button", { name: "Load more jobs", exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await page
        .getByRole("button", { name: "Retry more jobs", exact: true })
        .waitFor();
      assert.equal(cursorRequests, 1);
      assert.equal(await page.locator("article").count(), 2);
      await page
        .getByRole("button", { name: "Retry more jobs", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Additional paginated job", exact: true })
        .waitFor();
      assert.equal(await page.locator("article").count(), 3);
      assert.equal(listCostingRequests, 0);
      assert.deepEqual(errors, []);
    } finally {
      // The shared runner closes its browser and retains artifacts on failure.
    }
  },
);
