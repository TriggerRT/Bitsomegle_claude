import { type Browser, expect, type Page, test, type WebSocketRoute } from '@playwright/test';
import {
  closeEveryone,
  expectChatting,
  expectVideoPlaying,
  expectWaiting,
  mediaTracks,
  messages,
  nextButton,
  openPerson,
  recordMediaStreams,
  say,
  startButton,
  startChatBetween,
} from './helpers.ts';

/**
 * What happens when someone's connection to the SERVER drops for a moment. The video
 * itself goes directly between the two browsers, so in these tests it is never cut;
 * only the connection that carries text and "who is matched with whom" is.
 *
 * Unless a test says otherwise the drop is one the server does not notice, because that
 * is how real networks fail: nobody tells the server that someone's Wi-Fi went off.
 *
 * The test server keeps a call for 1.5 seconds (playwright.config.ts); production: 10.
 */

test.afterEach(async ({ browser }) => closeEveryone(browser));

/** The test's remote control for one person's connection to the server. */
interface Network {
  /**
   * Cuts the connection the way a real network problem does: the page finds out, the
   * server does NOT (to the server the connection still looks alive).
   * - `stayOffline`: the connection cannot be re-established until `restore()`.
   * - `serverNotices`: the server is told too, as when a browser crashes.
   */
  drop: (options?: { stayOffline?: boolean; serverNotices?: boolean }) => Promise<void>;
  restore: () => void;
}

/** Opens the app for a person whose connection to the server the test can cut. */
async function openPersonWithNetwork(
  browser: Browser,
  beforeLoad?: () => void,
): Promise<{ page: Page; network: Network }> {
  let offline = false;
  const open: Array<{ page: WebSocketRoute; server: WebSocketRoute; cut: boolean }> = [];

  const page = await openPerson(browser, beforeLoad, '/', async (newPage) => {
    // Every WebSocket the app opens to the server passes through here.
    await newPage.routeWebSocket(/\/socket\.io\//, (ws) => {
      if (offline) {
        ws.close();
        return;
      }
      const server = ws.connectToServer();
      // Pass an ordinary close on to the other side ourselves. (Installing these handlers
      // switches off Playwright's automatic forwarding, so that `drop()` below can close
      // one side only.)
      const link = { page: ws, server, cut: false };
      ws.onClose((code, reason) => {
        if (!link.cut) void server.close({ code, reason });
      });
      server.onClose((code, reason) => {
        if (!link.cut) void ws.close({ code, reason });
      });
      open.push(link);
    });
    // So do its ordinary requests to the server (Socket.IO starts with those).
    await newPage.route(/\/socket\.io\//, (route) => (offline ? route.abort() : route.continue()));
  });

  const network: Network = {
    drop: async ({ stayOffline = false, serverNotices = false } = {}) => {
      offline = stayOffline;
      for (const link of open.splice(0)) {
        link.cut = true; // from now on nothing is passed between the two sides
        if (serverNotices) await link.server.close();
        await link.page.close();
      }
    },
    restore: () => {
      offline = false;
    },
  };
  return { page, network };
}

const reconnecting = (page: Page) => page.getByText('Connection lost. Reconnecting…');

test('a short connection drop does not end the call', async ({ browser }) => {
  const { page: alice, network } = await openPersonWithNetwork(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);
  await expectVideoPlaying(alice, 'remote-video');
  await say(bob, 'before the drop');
  await expect(messages(alice)).toContainText(['before the drop']);

  await network.drop();

  await expect(reconnecting(alice)).toBeVisible();
  await expect(reconnecting(alice)).toBeHidden({ timeout: 15_000 });

  // Still the same conversation on both sides, and text flows again in both directions.
  await expectChatting(alice);
  await expectChatting(bob);
  await say(alice, 'did you notice anything?');
  await say(bob, 'no, nothing');
  await expect(messages(bob)).toContainText(['before the drop', 'did you notice anything?']);
  await expect(messages(alice)).toContainText(['before the drop', 'no, nothing']);
  await expect(bob.getByText('Stranger disconnected.')).toHaveCount(0);
  await expectVideoPlaying(alice, 'remote-video');
  await expectVideoPlaying(bob, 'remote-video');
});

test('a message sent to someone who is briefly offline still arrives', async ({ browser }) => {
  const { page: alice, network } = await openPersonWithNetwork(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);

  await network.drop();
  await expect(reconnecting(alice)).toBeVisible();
  await say(bob, 'sent while you were away');

  await expect(messages(alice)).toContainText(['sent while you were away'], { timeout: 15_000 });
});

test('the message box is disabled while reconnecting', async ({ browser }) => {
  const { page: alice, network } = await openPersonWithNetwork(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);

  await network.drop({ stayOffline: true });

  await expect(reconnecting(alice)).toBeVisible();
  await expect(alice.getByRole('textbox', { name: 'Message' })).toBeDisabled();
});

test('staying offline too long ends the chat for both, and the camera goes off', async ({
  browser,
}) => {
  const { page: alice, network } = await openPersonWithNetwork(browser, recordMediaStreams);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);

  // Here the server is told. Otherwise it would first take up to 20 seconds to find out
  // for itself that Alice is gone, and only then start waiting for her.
  await network.drop({ stayOffline: true, serverNotices: true });

  // Bob is told once the server has stopped waiting for Alice.
  await expect(bob.getByText('Stranger disconnected.')).toBeVisible({ timeout: 10_000 });
  // Alice does not know yet: she cannot reach the server.
  await expect(reconnecting(alice)).toBeVisible();

  network.restore();

  // Back online, she learns the chat is gone and lands on the start page.
  await expect(alice.getByText('Your connection dropped, so the chat ended.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(startButton(alice)).toBeEnabled();
  expect(await mediaTracks(alice)).toMatchObject({ stillLive: 0 });
  expect((await mediaTracks(alice)).obtained).toBeGreaterThan(0);

  // And she can start again straight away.
  await startButton(alice).click();
  await expectWaiting(alice);
  await nextButton(bob).click();
  await expectChatting(alice);
  await expectChatting(bob);
});

test('someone waiting keeps waiting through a drop and is still matched', async ({ browser }) => {
  const { page: alice, network } = await openPersonWithNetwork(browser);
  const bob = await openPerson(browser);
  await startButton(alice).click();
  await expectWaiting(alice);

  await network.drop();
  await expect(reconnecting(alice)).toBeVisible();
  await expect(reconnecting(alice)).toBeHidden({ timeout: 15_000 });
  await expectWaiting(alice);

  // She rejoined the queue by herself, so a newcomer finds her.
  await startButton(bob).click();
  await expectChatting(alice);
  await expectChatting(bob);
  await expectVideoPlaying(bob, 'remote-video');
});
