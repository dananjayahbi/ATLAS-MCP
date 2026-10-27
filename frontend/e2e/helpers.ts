import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Doc 10 §6 — shared E2E helpers.
 *
 * Playwright's actionability checks cover visibility and pointer events but not
 * **hydration**. A server-rendered button that has not yet been hydrated accepts a
 * click and does nothing, which produces an intermittent "the URL never changed"
 * failure on a slower machine. `openDialog` retries the click until the dialog
 * actually mounts, which is the observable hydration signal.
 */

export function unique(prefix = "e2e"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

export async function openDialog(page: Page, trigger: Locator, dialogName: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: dialogName });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(trigger).toBeVisible();
    await trigger.click();
    if (await dialog.isVisible().catch(() => false)) return dialog;
    await page.waitForTimeout(300);
  }
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Wait until the client bundle has run: the board only paints after hydration. */
export async function waitForProjectBoard(page: Page): Promise<void> {
  await expect(page.getByRole("grid", { name: "Task board" })).toBeVisible();
}
