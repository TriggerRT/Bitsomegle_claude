import { type Browser, expect, type Page } from '@playwright/test';

/**
 * Opens the app for one "person". Each gets their own browser context, which is like a
 * separate private window: nothing is shared between them except the server.
 *
 * `beforeLoad` runs inside the page before the app starts, for tests that need to change
 * how the browser behaves (for example, to pretend the camera is blocked).
 */
export async function openPerson(browser: Browser, beforeLoad?: () => void): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (beforeLoad) await page.addInitScript(beforeLoad);
  await page.goto('/');
  await expect(startButton(page)).toBeEnabled();
  return page;
}

export const startButton = (page: Page) => page.getByRole('button', { name: 'Start chatting' });
export const nextButton = (page: Page) => page.getByRole('button', { name: 'Next' });
export const leaveButton = (page: Page) => page.getByRole('button', { name: 'Leave' });
export const messageBox = (page: Page) => page.getByRole('textbox', { name: 'Message' });
export const messages = (page: Page) => page.locator('.message');

export async function say(page: Page, text: string): Promise<void> {
  await messageBox(page).fill(text);
  await messageBox(page).press('Enter');
}

export const expectWaiting = (page: Page) =>
  expect(page.getByText('Looking for someone…')).toBeVisible();
export const expectChatting = (page: Page) =>
  expect(page.getByText("You're chatting with a stranger.")).toBeVisible();

/** Starts two people and waits until they are in a chat together. */
export async function startChatBetween(a: Page, b: Page): Promise<void> {
  await startButton(a).click();
  await expectWaiting(a);
  await startButton(b).click();
  await expectChatting(a);
  await expectChatting(b);
}

/** Closes every window, so nobody is left in the queue for the next test. */
export async function closeEveryone(browser: Browser): Promise<void> {
  await Promise.all(browser.contexts().map((context) => context.close()));
}
