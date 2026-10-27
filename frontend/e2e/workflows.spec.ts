import { expect, test } from "@playwright/test";
import { openDialog, unique, waitForProjectBoard } from "./helpers";

/**
 * Doc 10 §5 — regression guards for the operator workflows: create task, create
 * project, header dashboard link, board search and triage persistence.
 *
 * Each test cleans up after itself so the suite is repeatable against a live
 * database (there is no hard-delete route, so tasks/projects are archived).
 */

test.describe("create task", () => {
  test("creates a task with a DoD checklist and opens it", async ({ page, request }) => {
    const title = `E2E task ${unique()}`;

    await page.goto("/projects/alpha");
    await waitForProjectBoard(page);

    const dialog = await openDialog(page, page.getByRole("button", { name: /New task/i }), "New task");
    await dialog.getByLabel(/^Title/).fill(title);
    await dialog.getByLabel(/^Description/).fill("Created by the Playwright regression suite.");
    await dialog.getByLabel(/^Definition of done/).fill("First check\nSecond check");
    await dialog.getByRole("button", { name: /Create task/i }).click();

    await expect(page).toHaveURL(/\/projects\/alpha\/tasks\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("First check", { exact: false })).toBeVisible();

    const id = page.url().split("/").pop();
    if (id) await request.post(`/api/v1/tasks/${id}/archive/`, { data: {} });
  });

  test("rejects an empty form without navigating", async ({ page }) => {
    await page.goto("/projects/alpha");
    await waitForProjectBoard(page);

    const dialog = await openDialog(page, page.getByRole("button", { name: /New task/i }), "New task");
    await dialog.getByRole("button", { name: /Create task/i }).click();

    await expect(dialog.getByText("Title is required.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/alpha$/);
  });
});

test.describe("board search", () => {
  test("filters by title and round-trips through the URL", async ({ page }) => {
    await page.goto("/projects/alpha?q=JWT");
    await waitForProjectBoard(page);

    const search = page.getByRole("searchbox", { name: "Search tasks" });
    await expect(search).toHaveValue("JWT");
    await expect(page.getByRole("link", { name: /JWT expiry race condition/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Agent heartbeat jitter tolerance/i })).toHaveCount(0);
  });

  test("writes the query into the URL after typing", async ({ page }) => {
    await page.goto("/projects/alpha");
    await waitForProjectBoard(page);

    const search = page.getByRole("searchbox", { name: "Search tasks" });
    await search.fill("JWT");
    // The input debounces 250 ms before it writes to the URL.
    await expect(page).toHaveURL(/[?&]q=JWT/);
    await expect(page.getByRole("link", { name: /JWT expiry race condition/i })).toBeVisible();
  });
});

test.describe("header dashboard link", () => {
  test("opens the last used project dashboard", async ({ page }) => {
    await page.goto("/projects/alpha");
    await waitForProjectBoard(page);
    await page.goto("/reviews");

    const link = page.getByRole("link", { name: /Dashboard/i });
    await expect(link).toHaveAttribute("href", "/projects/alpha");
    await link.click();
    await expect(page).toHaveURL(/\/projects\/alpha$/);
  });
});

test.describe("create project", () => {
  test("registers a project and opens its dashboard", async ({ page, request }) => {
    const name = `E2E ${unique()}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();

    const dialog = await openDialog(page, page.getByRole("button", { name: /New$/ }), "New project");
    await dialog.getByLabel(/^Name/).fill(name);

    // The slug is derived by normalising non-alphanumerics, so read what the form
    // computed rather than assuming it matches the name.
    const derived = await dialog.getByLabel(/^Slug/).inputValue();
    expect(derived).toMatch(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/);

    await dialog.getByLabel(/^Repository path/).fill(`E:\\dev\\${derived}`);
    await dialog.getByRole("button", { name: /^Create project/ }).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${derived}$`));
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // Archive rather than delete: there is no hard-delete route (Doc 01 §8 T12).
    await request.delete(`/api/v1/projects/${derived}/`);
  });

  test("blocks a slug shorter than three characters", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();

    const dialog = await openDialog(page, page.getByRole("button", { name: /New$/ }), "New project");
    await dialog.getByLabel(/^Name/).fill("ab");
    await dialog.getByLabel(/^Repository path/).fill("E:\\dev\\ab");
    await dialog.getByRole("button", { name: /^Create project/ }).click();

    await expect(dialog.getByText(/3–32 chars/)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
