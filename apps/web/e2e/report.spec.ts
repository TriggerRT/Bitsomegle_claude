import { expect, type Page, test } from '@playwright/test';
import {
  closeEveryone,
  expectChatting,
  expectWaiting,
  mediaTracks,
  nextButton,
  openPerson,
  recordMediaStreams,
  startButton,
  startChatBetween,
} from './helpers.ts';

/** "Report and skip", the rules on the landing page, and the people-online line. */

test.afterEach(async ({ browser }) => closeEveryone(browser));

const reportButton = (page: Page) => page.getByRole('button', { name: 'Report', exact: true });
const reportDialog = (page: Page) => page.getByRole('dialog', { name: 'Report this person?' });
const cancelButton = (page: Page) => page.getByRole('button', { name: 'Cancel' });
const THANKS = "Thanks, your report was noted. You won't be matched with that person again.";

/** Opens the dialog and picks a reason. */
async function report(page: Page, reason = 'Nudity or sexual content'): Promise<void> {
  await reportButton(page).click();
  await reportDialog(page).getByRole('button', { name: reason }).click();
}

test('reporting during a chat skips the person, and the two never meet again', async ({
  browser,
}) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);

  await report(alice);

  // Alice is looking for someone new and is thanked. Bob only sees an ordinary skip.
  await expectWaiting(alice);
  await expect(alice.getByText(THANKS)).toBeVisible();
  await expect(bob.getByText('Stranger moved on.')).toBeVisible();
  await expect(bob.getByText(/reported you|Report sent|Thanks, your report/)).toHaveCount(0);

  // Bob looks again. Alice is the only other person waiting, but they are kept apart.
  await nextButton(bob).click();
  await expectWaiting(bob);
  await expectWaiting(alice);

  // A third person is matched with exactly one of them.
  const carol = await openPerson(browser);
  await startButton(carol).click();
  await expectChatting(carol);
  const chatting = [alice, bob].map((page) =>
    page.getByText("You're chatting with a stranger.").isVisible(),
  );
  expect((await Promise.all(chatting)).filter(Boolean)).toHaveLength(1);
});

test('the report dialog can be cancelled, by button or Escape, and nothing is sent', async ({
  browser,
}) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);

  await reportButton(alice).click();
  await expect(reportDialog(alice)).toBeVisible();
  await reportDialog(alice).getByRole('button', { name: 'Cancel' }).click();
  await expect(reportDialog(alice)).toBeHidden();

  await reportButton(alice).click();
  await expect(reportDialog(alice)).toBeVisible();
  await alice.keyboard.press('Escape');
  await expect(reportDialog(alice)).toBeHidden();
  // Keyboard focus is back where it was, so a keyboard user is not lost.
  await expect(reportButton(alice)).toBeFocused();

  await expectChatting(alice);
  await expectChatting(bob);
  await expect(bob.getByText('Stranger moved on.')).toHaveCount(0);
});

test('someone who left first can still be reported', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);
  await nextButton(bob).click();
  await expect(alice.getByText('Stranger moved on.')).toBeVisible();

  await report(alice, 'Harassment or hate');

  await expect(alice.getByText('Stranger moved on. Report sent, thank you.')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Reported' })).toBeDisabled();

  // Alice looks again; Bob is waiting, but they are kept apart.
  await nextButton(alice).click();
  await expectWaiting(alice);
  await expectWaiting(bob);
});

test('someone reported by three different people is blocked for a while', async ({ browser }) => {
  const offender = await openPerson(browser, recordMediaStreams);
  await startButton(offender).click();
  await expectWaiting(offender);

  for (let i = 0; i < 3; i += 1) {
    const reporter = await openPerson(browser);
    await startButton(reporter).click();
    await expectChatting(reporter);
    await report(reporter);
    // The reporter steps out of the queue, so the offender meets the next person.
    await cancelButton(reporter).click();
    if (i < 2) {
      await expect(offender.getByText('Stranger moved on.')).toBeVisible();
      await nextButton(offender).click();
      await expectWaiting(offender);
    }
  }

  const blocked = offender.getByText(/Several people reported you/);
  await expect(blocked).toBeVisible();
  await expect(startButton(offender)).toBeVisible();
  expect(await mediaTracks(offender)).toMatchObject({ stillLive: 0 });

  // Trying again straight away is refused with the same explanation.
  await offender.getByRole('button', { name: 'Dismiss' }).click();
  await expect(blocked).toBeHidden();
  await startButton(offender).click();
  await expect(blocked).toBeVisible();
  await expect(startButton(offender)).toBeVisible();
});

test('the landing page shows the rules and how many people are here', async ({ browser }) => {
  const alice = await openPerson(browser);

  await expect(alice.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  await expect(alice.getByText('No nudity, harassment or hate.')).toBeVisible();
  await expect(alice.getByText('By pressing Start you agree to follow these rules.')).toBeVisible();
  await expect(alice.getByText("You're the only one here right now.")).toBeVisible();

  // The number is refreshed by the server every 15 seconds.
  await openPerson(browser);
  await expect(alice.getByText('2 people here right now')).toBeVisible({ timeout: 20_000 });
});

test('someone waiting alone is told that nobody else is online', async ({ browser }) => {
  const alice = await openPerson(browser);
  await startButton(alice).click();
  await expectWaiting(alice);
  await expect(alice.getByText(/Nobody else is online right now/)).toBeVisible();
});
