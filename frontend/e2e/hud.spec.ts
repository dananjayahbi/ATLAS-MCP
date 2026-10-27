import { expect, test } from "@playwright/test";

/**
 * CAP-07 / CAP-08 / CAP-10 / CAP-11 — command center surfaces
 * (Doc 10 §11, §6.1). Runs against the real Django backend.
 *
 * Timeouts are generous: `next dev` compiles a route on first visit, which can
 * take longer than the default expect budget on a cold cache.
 */

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);
});

test.describe("command center", () => {
  test("renders the HUD shell with live telemetry", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    for (const label of ["DISCOVERIES", "OLDEST PENDING", "THROUGHPUT 24H"]) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Priority matrix" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Queue stats" })).toBeVisible();
  });

  test("has no hydration errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await page.waitForTimeout(2_000);

    const hydration = errors.filter((e) => /hydrat/i.test(e));
    expect(hydration, `hydration errors: ${hydration.join(" | ")}`).toHaveLength(0);
  });

  test("priority matrix plots points from the API", async ({ page }) => {
    await page.goto("/");
    const matrix = page.getByRole("region", { name: "Priority matrix" });
    await expect(matrix).toBeVisible();
    const label = matrix.getByText(/\d+ pts/).first();
    await expect(label).toBeVisible();
    expect(Number.parseInt(await label.innerText(), 10)).toBeGreaterThan(0);
  });

  test("keyboard: ? opens the cheat sheet, Esc closes it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("board", () => {
  test("project board loads its columns", async ({ page }) => {
    await page.goto("/projects/alpha");
    await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible();
    await expect(page.getByText("PENDING", { exact: false }).first()).toBeVisible();
  });

  test("split workspace offers 1x1 through 2x3 layouts", async ({ page }) => {
    await page.goto("/projects/alpha");
    const split = page.getByLabel("Split layout");
    await expect(split).toBeVisible();
    for (const label of ["1×1", "1×2", "2×2", "2×3"]) {
      await expect(split.getByRole("button", { name: label })).toBeVisible();
    }
  });
});

test.describe("task detail", () => {
  test("shows the DoD panel, description and live log", async ({ page }) => {
    // Navigate via the board so the URL is authoritative rather than guessed.
    // Board cards are links whose accessible name is the task title.
    await page.goto("/projects/alpha");
    const board = page.getByRole("grid", { name: "Task board" });
    await expect(board).toBeVisible();
    const card = board.getByRole("link").first();
    await expect(card).toBeVisible();
    await card.click();

    await expect(page.getByRole("heading", { name: /Definition of Done/i })).toBeVisible();
    await expect(page.getByRole("log")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Description/i })).toBeVisible();
  });
});

test.describe("triage inbox", () => {
  test("lists pending discoveries", async ({ page }) => {
    await page.goto("/discoveries");
    await expect(page.getByRole("heading", { name: /triage/i }).first()).toBeVisible();
    await expect(
      page.getByText("Discovery triage keyboard shortcuts", { exact: false }).first(),
    ).toBeVisible();
  });
});

test.describe("review gate", () => {
  test("lists the in-review task with sign-off controls", async ({ page }) => {
    await page.goto("/reviews");
    await expect(page.getByRole("heading", { name: "Review Gate" })).toBeVisible();
    await expect(
      page.getByText("Harden asset upload MIME sniffing", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign off/i })).toBeVisible();
  });
});
