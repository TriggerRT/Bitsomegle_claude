import { expect, type Page, test } from '@playwright/test';
import { closeEveryone, startButton } from './helpers.ts';

/**
 * The "closed" and "server full" screens. These need a server that is closed and almost
 * full, so playwright.config.ts starts a second server (and a second copy of the web app
 * pointing at it) just for this file.
 */
const SPECIAL_SITE = 'http://localhost:5274';

test.afterEach(async ({ browser }) => closeEveryone(browser));

async function openSpecialSite(browser: import('@playwright/test').Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(SPECIAL_SITE);
  return page;
}

test('outside opening hours the landing page says when it opens, and Start is disabled', async ({
  browser,
}) => {
  const visitor = await openSpecialSite(browser);

  // The special server opens in about six hours.
  await expect(visitor.getByText(/Closed right now\. Opens in \d+ h/)).toBeVisible();
  await expect(startButton(visitor)).toBeDisabled();
  // The rules are still shown while closed.
  await expect(visitor.getByRole('heading', { name: 'Before you start' })).toBeVisible();
});

test('a full server says so, and "Try again" gets in once there is room', async ({ browser }) => {
  // The special server accepts one visitor at a time.
  const first = await openSpecialSite(browser);
  await expect(first.getByText(/Closed right now/)).toBeVisible();

  const second = await openSpecialSite(browser);
  await expect(second.getByText('The server is full right now.')).toBeVisible();
  await expect(startButton(second)).toBeDisabled();

  await first.context().close();
  await second.getByRole('button', { name: 'Try again' }).click();

  await expect(second.getByText(/Closed right now/)).toBeVisible();
  await expect(second.getByText('The server is full right now.')).toBeHidden();
});
