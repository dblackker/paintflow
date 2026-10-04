import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { buildAcceptedEstimationBudget } from "../../packages/core/src/estimation-budget.ts";
import { calculateProductionEstimate } from "../../packages/core/src/estimation.ts";
import {
  compareJobEstimationBudget,
  jobFinancialPosition,
  type JobEstimationEvidence,
} from "../../packages/core/src/job-financial-position.ts";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const legacyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";
const scopeItemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11";
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

function budgetDetail(id: string, withScope = false, operationDescription?: string) {
  const evidence: JobEstimationEvidence = {
    jobId: id,
    status: "completed",
    budget: null,
    changes: [],
    time: id === legacyId ? [] : [{
      id: "t1", hours: "2", totalCost: "100", date: "2026-10-03",
      reviewStatus: "approved", operationId: null,
    }],
    costs: id === legacyId ? [] : detail.lists.costs.map((cost) => ({
      id: cost.id, category: cost.category, totalCost: String(cost.totalCost),
      costDate: "2026-10-03", materialPurchaseId: null,
    })),
    purchases: [],
    pendingSupplierCount: 0,
    revision: "a".repeat(32),
  };
  if (withScope) {
    const calculation = calculateProductionEstimate({
      calculationVersion: "repaint-v2",
      surfaces: [{
        id: scopeItemId, quantity: "160", unit: "sqft", coats: 2,
        labor: {
          productionRatePerHour: "80", sellingRate: "50", burdenedRate: "30",
          rateBasis: "complete_system", applicationMethod: "brush_roll",
        },
      }],
    });
    calculation.items[0].operations![0].description = operationDescription;
    evidence.budget = buildAcceptedEstimationBudget("e1", {
      name: "proposal", total: "1000", calculationVersion: "repaint-v2",
      calculationSnapshot: calculation,
      items: [{ calculationItemId: scopeItemId, desc: "Bedroom walls", roomName: "Bedroom", surfaceName: "Walls", qty: "160", rate: "1" }],
    }, [], "2026-10-01T12:00:00Z") as NonNullable<JobEstimationEvidence["budget"]>;
  }
  return {
    comparison: compareJobEstimationBudget(evidence, summary.asOf),
    observations: [],
    canReview: true,
    rates: [],
  };
}

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
      let scopedBudget = false;
      let operationDescription: string | undefined;
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
        if (path === `/v1/estimation-observations/jobs/${jobId}`)
          data = budgetDetail(jobId, scopedBudget, operationDescription);
        if (path === `/v1/estimation-observations/jobs/${legacyId}`)
          data = budgetDetail(legacyId);
        if (path === "/v1/change-orders" && route.request().method() === "POST")
          data = { id: "co-draft", ...route.request().postDataJSON() };
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
        scopedBudget = false;
        operationDescription = width >= 768 ? " Protect adjacent colors " : width === 360 ? undefined : " ";
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
        const costPosition = page.getByRole("region", { name: "Job cost position" });
        await expect(costPosition.getByText(
          "Work is complete. Final margin remains unverified.", { exact: true },
        )).toBeVisible();
        await expect(costPosition.getByText("80% recorded margin", { exact: true })).toBeVisible();
        await expect(costPosition.getByText("Cost capture incomplete", { exact: true })).toBeVisible();
        await expect(costPosition.getByText(
          "Before customer tax. Recorded costs are not final costs.", { exact: true },
        )).toBeVisible();
        const budget = page.getByRole("region", { name: "Budget To Actual" });
        await expect(budget.getByText("Accepted operating budget is unavailable.", { exact: true })).toBeVisible();
        await expect(budget.locator("dl > div").filter({
          has: page.getByText("Budget direct cost", { exact: true }),
        }).locator("dd")).toHaveText("Unknown");
        await expect(budget.locator("dl > div").filter({
          has: page.getByText("Dated ledger costs", { exact: true }),
        }).locator("dd")).toHaveText("$200.00");
        await expect(budget.getByRole("button", { name: "Review closeout", exact: true })).toBeDisabled();
        const detailAmounts = await page
          .getByRole("region", { name: "Job financial summary" })
          .locator("dd")
          .allTextContents();
        assert.deepEqual(detailAmounts, listAmounts);
        scopedBudget = true;
        await budget.getByRole("button", { name: "Reload budget comparison", exact: true }).click();
        const tasksSummary = budget.locator("summary").filter({ hasText: /^Operating Tasks$/ });
        const attributionSummary = budget.locator("summary").filter({ hasText: /^Approved Time Attribution$/ });
        const rateSummary = budget.locator("summary").filter({ hasText: /^Reviewed Rate Version$/ });
        for (const sectionSummary of [tasksSummary, attributionSummary, rateSummary]) {
          await expect(sectionSummary).toBeVisible();
          await expect(sectionSummary.locator("..")).toHaveJSProperty("open", false);
        }
        await expect(budget.getByRole("button", { name: "Review closeout", exact: true })).toBeVisible();
        await tasksSummary.click();
        await expect(tasksSummary.locator("..").getByText(operationDescription?.trim() || "Bedroom walls \u00b7 Application", { exact: true })).toBeVisible();
        await expect(tasksSummary.locator("..")).not.toContainText(scopeItemId);
        await attributionSummary.click();
        const taskSelect = budget.getByRole("combobox", { name: /^Task for 2 approved hours/ });
        await expect(taskSelect.locator("option").filter({ hasText: operationDescription?.trim() || "Bedroom walls: Application" })).toHaveAttribute("value", `${scopeItemId}:application`);
        await taskSelect.selectOption(`${scopeItemId}:application`);
        await expect(taskSelect).toHaveValue(`${scopeItemId}:application`);
        await rateSummary.click();
        await expect(budget.getByRole("button", { name: "Preview rate", exact: true })).toBeVisible();
        await rateSummary.click();
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
        const changeDialog = page.getByRole("dialog", { name: "Add Change Order", exact: true });
        await expect(changeDialog.getByLabel("Amount including tax", { exact: true })).toBeVisible();
        if (width === 360) {
          await changeDialog.getByLabel("Customer-facing summary", { exact: true }).fill("Add garage trim");
          await changeDialog.getByLabel("Amount including tax", { exact: true }).fill("109.20");
          const submitted = page.waitForRequest((request) =>
            new URL(request.url()).pathname === "/v1/change-orders" && request.method() === "POST",
          );
          await changeDialog.getByRole("button", { name: "Save draft", exact: true }).click();
          const request = await submitted;
          assert.equal(request.postDataJSON().amount, 109.2, "Entered gross amount must not be repriced or taxed again");
          assert.equal(request.postDataJSON().status, "draft");
          assert.equal(request.postDataJSON().jobId, jobId);
          await expect(changeDialog).not.toBeVisible();
        } else {
          await changeDialog.getByRole("button", { name: "Close dialog", exact: true }).click();
        }
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
