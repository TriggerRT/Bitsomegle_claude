import { type Browser, expect, type Page } from '@playwright/test';

/**
 * Opens the app for one "person". Each gets their own browser context, which is like a
 * separate private window: nothing is shared between them except the server.
 *
 * `beforeLoad` runs inside the page before the app starts, for tests that need to change
 * how the browser behaves (for example, to pretend the camera is blocked). `address` is
 * the page to open, for tests that need something after the "?". `prepare` runs in the test
 * itself before the page loads, for example to take control of the page's network.
 */
export async function openPerson(
  browser: Browser,
  beforeLoad?: () => void,
  address = '/',
  prepare?: (page: Page) => Promise<void>,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (beforeLoad) await page.addInitScript(beforeLoad);
  if (prepare) await prepare(page);
  await page.goto(address);
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

export interface VideoInfo {
  width: number;
  time: number;
  liveAudioTracks: number;
  liveVideoTracks: number;
}

/** Facts about a <video> element, read inside the page. */
export function videoInfo(page: Page, testId: string): Promise<VideoInfo | null> {
  return page.evaluate((id) => {
    const video = document.querySelector<HTMLVideoElement>(`video[data-testid="${id}"]`);
    if (!video) return null;
    const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
    const live = (tracks: MediaStreamTrack[]) =>
      tracks.filter((track) => track.readyState === 'live').length;
    return {
      width: video.videoWidth,
      time: video.currentTime,
      liveAudioTracks: stream ? live(stream.getAudioTracks()) : 0,
      liveVideoTracks: stream ? live(stream.getVideoTracks()) : 0,
    };
  }, testId);
}

/** Passes once the video has a picture and its clock is moving, i.e. frames are arriving. */
export async function expectVideoPlaying(page: Page, testId: string): Promise<void> {
  await expect
    .poll(async () => ((await videoInfo(page, testId))?.width ?? 0) > 0, { timeout: 15_000 })
    .toBe(true);
  const before = (await videoInfo(page, testId))?.time ?? 0;
  await expect
    .poll(async () => ((await videoInfo(page, testId))?.time ?? 0) > before, { timeout: 15_000 })
    .toBe(true);
}

/**
 * Runs before the app loads: remembers every camera/microphone stream the page obtains,
 * so a test can check later that they were all switched off.
 */
export function recordMediaStreams(): void {
  const obtained: MediaStream[] = [];
  (window as unknown as { obtainedStreams: MediaStream[] }).obtainedStreams = obtained;
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await original(constraints);
    obtained.push(stream);
    return stream;
  };
}

/** How many camera/microphone tracks the page still has switched on, and how many it ever got. */
export function mediaTracks(page: Page): Promise<{ obtained: number; stillLive: number }> {
  return page.evaluate(() => {
    const streams = (window as unknown as { obtainedStreams: MediaStream[] }).obtainedStreams;
    const tracks = streams.flatMap((stream) => stream.getTracks());
    return {
      obtained: tracks.length,
      stillLive: tracks.filter((track) => track.readyState === 'live').length,
    };
  });
}
