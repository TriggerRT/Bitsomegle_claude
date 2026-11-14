import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * Each "person" gets their own browser context, which is like a separate private window:
 * nothing is shared between them except the server.
 */
async function openPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start chatting' })).toBeEnabled();
  return page;
}

const startButton = (page: Page) => page.getByRole('button', { name: 'Start chatting' });
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next' });
const leaveButton = (page: Page) => page.getByRole('button', { name: 'Leave' });
const messageBox = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const messages = (page: Page) => page.locator('.message');

async function say(page: Page, text: string): Promise<void> {
  await messageBox(page).fill(text);
  await messageBox(page).press('Enter');
}

const expectWaiting = (page: Page) => expect(page.getByText('Looking for someone…')).toBeVisible();
const expectChatting = (page: Page) =>
  expect(page.getByText("You're chatting with a stranger.")).toBeVisible();

/** Marks the page so we can prove later that it was never reloaded. */
async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { neverReloaded: boolean }).neverReloaded = true;
  });
}
const wasNeverReloaded = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { neverReloaded?: boolean }).neverReloaded === true);

test.afterEach(async ({ browser }) => {
  // Close every window so nobody is left in the queue for the next test.
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test('full journey: start, match, chat, Next, match again, leave', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  const carol = await openPerson(browser);
  for (const page of [alice, bob, carol]) await markPage(page);

  // Alice starts and waits; Bob starts and they are matched.
  await startButton(alice).click();
  await expectWaiting(alice);
  await startButton(bob).click();
  await expectChatting(alice);
  await expectChatting(bob);

  // They talk. Each sees their own message and the other's.
  await say(alice, 'hello from alice');
  await expect(messages(bob)).toHaveText(['Strangerhello from alice']);
  await say(bob, 'hi alice, bob here');
  await expect(messages(alice)).toHaveText(['Youhello from alice', 'Strangerhi alice, bob here']);
  await expect(alice.getByText('Not delivered')).toHaveCount(0);

  // Carol starts and waits. Alice presses Next and is matched with Carol.
  await startButton(carol).click();
  await expectWaiting(carol);
  await nextButton(alice).click();
  await expectChatting(carol);
  await expectChatting(alice);

  // Alice's new chat is empty: nothing from the conversation with Bob carries over.
  await expect(messages(alice)).toHaveCount(0);
  await expect(messages(carol)).toHaveCount(0);

  // Bob is told, can still read the old conversation, but cannot write.
  await expect(bob.getByText('Stranger moved on.')).toBeVisible();
  await expect(messages(bob)).toHaveCount(2);
  await expect(messageBox(bob)).toBeDisabled();

  // Messages go only to the current partner.
  await say(alice, 'hello carol');
  await expect(messages(carol)).toHaveText(['Strangerhello carol']);
  await expect(messages(bob)).toHaveCount(2);

  // Bob presses Next and waits (Alice and Carol are busy).
  await nextButton(bob).click();
  await expectWaiting(bob);

  // Alice leaves for good. Carol is told; Alice is back on the landing page.
  await leaveButton(alice).click();
  await expect(startButton(alice)).toBeVisible();
  await expect(carol.getByText('Stranger left.')).toBeVisible();

  // Carol presses Next and is matched with Bob, who was waiting.
  await nextButton(carol).click();
  await expectChatting(carol);
  await expectChatting(bob);
  await say(bob, 'finally someone');
  await expect(messages(carol)).toHaveText(['Strangerfinally someone']);

  // Nobody's page was ever reloaded during all of that.
  for (const page of [alice, bob, carol]) expect(await wasNeverReloaded(page)).toBe(true);
});

test('cancelling while waiting returns to the start, and starting again works', async ({
  browser,
}) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);

  await startButton(alice).click();
  await expectWaiting(alice);
  await alice.getByRole('button', { name: 'Cancel' }).click();
  await expect(startButton(alice)).toBeVisible();

  // Alice cancelled, so Bob must not be matched with her.
  await startButton(bob).click();
  await expectWaiting(bob);

  await startButton(alice).click();
  await expectChatting(alice);
  await expectChatting(bob);
});

test('closing the tab ends the chat for the partner', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);

  await startButton(alice).click();
  await startButton(bob).click();
  await expectChatting(bob);

  await alice.context().close();

  await expect(bob.getByText('Stranger disconnected.')).toBeVisible();
  await nextButton(bob).click();
  await expectWaiting(bob);
});

test('pressing Next rapidly never breaks the pairing', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);

  await startButton(alice).click();
  await startButton(bob).click();
  await expectChatting(alice);

  // With only two people online, each Next re-pairs them. Do it a few times from both sides.
  for (let round = 0; round < 2; round += 1) {
    await nextButton(alice).click();
    await expect(bob.getByText('Stranger moved on.')).toBeVisible();
    await nextButton(bob).click();
    await expectChatting(alice);
    await expectChatting(bob);
  }

  await say(alice, 'still works');
  await expect(messages(bob)).toHaveText(['Strangerstill works']);
});

test('whitespace-only messages are not sent', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  await startButton(alice).click();
  await startButton(bob).click();
  await expectChatting(alice);

  await messageBox(alice).fill('    ');
  await expect(alice.getByRole('button', { name: 'Send' })).toBeDisabled();
  await messageBox(alice).press('Enter');
  await say(alice, 'real message');

  await expect(messages(bob)).toHaveText(['Strangerreal message']);
});
