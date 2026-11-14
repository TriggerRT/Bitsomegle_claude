import { expect, type Page, test } from '@playwright/test';
import {
  closeEveryone,
  expectChatting,
  expectWaiting,
  leaveButton,
  messages,
  nextButton,
  openPerson,
  say,
  startButton,
  startChatBetween,
} from './helpers.ts';

/**
 * These tests make real WebRTC video calls between browser windows, using Chromium's
 * pretend camera and microphone (see playwright.config.ts).
 */

test.afterEach(async ({ browser }) => closeEveryone(browser));

interface VideoInfo {
  width: number;
  time: number;
  liveAudioTracks: number;
  liveVideoTracks: number;
}

/** Facts about a <video> element, read inside the page. */
function videoInfo(page: Page, testId: string): Promise<VideoInfo | null> {
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
async function expectVideoPlaying(page: Page, testId: string): Promise<void> {
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
function recordMediaStreams(): void {
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
function mediaTracks(page: Page): Promise<{ obtained: number; stillLive: number }> {
  return page.evaluate(() => {
    const streams = (window as unknown as { obtainedStreams: MediaStream[] }).obtainedStreams;
    const tracks = streams.flatMap((stream) => stream.getTracks());
    return {
      obtained: tracks.length,
      stillLive: tracks.filter((track) => track.readyState === 'live').length,
    };
  });
}

test('two people see and hear each other', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);

  // While waiting, Alice sees her own camera.
  await startButton(alice).click();
  await expectWaiting(alice);
  await expectVideoPlaying(alice, 'local-video');

  await startButton(bob).click();
  await expectChatting(alice);
  await expectChatting(bob);

  // Each sees the other's moving picture, and the "Connecting video…" notice goes away.
  await expectVideoPlaying(alice, 'remote-video');
  await expectVideoPlaying(bob, 'remote-video');
  await expect(alice.getByText('Connecting video…')).toHaveCount(0);
  await expect(bob.getByText('Connecting video…')).toHaveCount(0);

  // The incoming stream carries both picture and sound.
  for (const page of [alice, bob]) {
    expect(await videoInfo(page, 'remote-video')).toMatchObject({
      liveAudioTracks: 1,
      liveVideoTracks: 1,
    });
  }

  // Our own preview is silent (or we would hear ourselves); the partner's is not.
  expect(await alice.getByTestId('local-video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(
    true,
  );
  expect(await alice.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(
    false,
  );

  // Text chat works alongside video.
  await say(alice, 'can you see me?');
  await expect(messages(bob)).toHaveText(['Strangercan you see me?']);
});

test('Next swaps the video to the new partner', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  const carol = await openPerson(browser);

  await startChatBetween(alice, bob);
  await expectVideoPlaying(alice, 'remote-video');
  const firstPartnerStream = await alice
    .getByTestId('remote-video')
    .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id);

  await startButton(carol).click();
  await expectWaiting(carol);
  await nextButton(alice).click();
  await expectChatting(carol);
  await expectChatting(alice);

  // Alice and Carol now see each other, on a different stream from the one Bob sent.
  await expectVideoPlaying(alice, 'remote-video');
  await expectVideoPlaying(carol, 'remote-video');
  const secondPartnerStream = await alice
    .getByTestId('remote-video')
    .evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id);
  expect(secondPartnerStream).not.toBe(firstPartnerStream);

  // Bob no longer has a partner video, but still sees himself.
  await expect(bob.getByText('Stranger moved on.')).toBeVisible();
  await expect(bob.getByTestId('remote-video')).toHaveCount(0);
  await expectVideoPlaying(bob, 'local-video');
});

test('repeated Next keeps producing working calls', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);
  await expectVideoPlaying(bob, 'remote-video');

  // With two people online each round re-pairs them, with a brand new call every time.
  for (let round = 0; round < 3; round += 1) {
    await nextButton(alice).click();
    await expect(bob.getByText('Stranger moved on.')).toBeVisible();
    await nextButton(bob).click();
    await expectChatting(alice);
    await expectVideoPlaying(alice, 'remote-video');
    await expectVideoPlaying(bob, 'remote-video');
  }
});

test('the camera and microphone are switched off after Leave', async ({ browser }) => {
  const alice = await openPerson(browser, recordMediaStreams);
  const bob = await openPerson(browser, recordMediaStreams);

  await startChatBetween(alice, bob);
  await expectVideoPlaying(alice, 'remote-video');
  expect(await mediaTracks(alice)).toEqual({ obtained: 2, stillLive: 2 });

  // Going through another partner must not ask for the camera a second time.
  await nextButton(alice).click();
  await nextButton(bob).click();
  await expectChatting(alice);
  expect(await mediaTracks(alice)).toEqual({ obtained: 2, stillLive: 2 });

  await leaveButton(alice).click();
  await expect(startButton(alice)).toBeVisible();

  expect(await mediaTracks(alice)).toEqual({ obtained: 2, stillLive: 0 });
  await expect(alice.locator('video')).toHaveCount(0);

  // Bob was left behind: his camera stays on until he leaves too.
  await expect(bob.getByText('Stranger left.')).toBeVisible();
  expect(await mediaTracks(bob)).toEqual({ obtained: 2, stillLive: 2 });
  await leaveButton(bob).click();
  await expect(startButton(bob)).toBeVisible();
  expect(await mediaTracks(bob)).toEqual({ obtained: 2, stillLive: 0 });
});

/**
 * Runs before the app loads: remembers every call connection the page creates, so a test
 * can check that old ones are really closed and not left running in the background.
 */
function recordConnections(): void {
  const created: RTCPeerConnection[] = [];
  (window as unknown as { createdConnections: RTCPeerConnection[] }).createdConnections = created;
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      created.push(this);
    }
  };
}

/** The state of every call connection the page has ever created, oldest first. */
function connectionStates(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { createdConnections: RTCPeerConnection[] }).createdConnections.map(
      (connection) => connection.connectionState,
    ),
  );
}

test('the connection to the previous partner is closed, not left running', async ({ browser }) => {
  const alice = await openPerson(browser, recordConnections);
  const bob = await openPerson(browser, recordConnections);
  const carol = await openPerson(browser, recordConnections);

  await startChatBetween(alice, bob);
  await expectVideoPlaying(alice, 'remote-video');
  expect(await connectionStates(alice)).toEqual(['connected']);

  // Alice moves on to Carol. Her connection to Bob must be shut, or her camera would keep
  // streaming to him.
  await startButton(carol).click();
  await expectWaiting(carol);
  await nextButton(alice).click();
  await expectChatting(carol);
  await expectVideoPlaying(alice, 'remote-video');
  expect(await connectionStates(alice)).toEqual(['closed', 'connected']);

  // Bob, who was left behind, has no connection open either.
  await expect(bob.getByText('Stranger moved on.')).toBeVisible();
  expect(await connectionStates(bob)).toEqual(['closed']);

  // After Leave nothing is left open on either side.
  await leaveButton(alice).click();
  await expect(startButton(alice)).toBeVisible();
  expect(await connectionStates(alice)).toEqual(['closed', 'closed']);
  await expect(carol.getByText('Stranger left.')).toBeVisible();
  expect(await connectionStates(carol)).toEqual(['closed']);
});

test('adding ?relay=1 to the address makes that browser use the relay only', async ({
  browser,
}) => {
  const policies = (page: Page): Promise<(string | undefined)[]> =>
    page.evaluate(() =>
      (window as unknown as { createdConnections: RTCPeerConnection[] }).createdConnections.map(
        (connection) => connection.getConfiguration().iceTransportPolicy,
      ),
    );
  const alice = await openPerson(browser, recordConnections, '/?relay=1');
  const bob = await openPerson(browser, recordConnections);

  await startChatBetween(alice, bob);

  expect(await policies(alice)).toEqual(['relay']);
  expect(await policies(bob)).toEqual(['all']);

  // The test server has no relay, so Alice's video cannot connect. Text does not go
  // through the call, so it must keep working.
  await say(alice, 'can you read this?');
  await expect(messages(bob)).toContainText(['can you read this?']);
  await expect(alice.getByTestId('remote-video')).toHaveJSProperty('videoWidth', 0);
});

test('cancelling while waiting switches the camera off', async ({ browser }) => {
  const alice = await openPerson(browser, recordMediaStreams);

  await startButton(alice).click();
  await expectWaiting(alice);
  await alice.getByRole('button', { name: 'Cancel' }).click();

  await expect(startButton(alice)).toBeVisible();
  expect(await mediaTracks(alice)).toEqual({ obtained: 2, stillLive: 0 });
});

test('turning the camera off and muting are shown to the partner', async ({ browser }) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);
  await startChatBetween(alice, bob);
  await expectVideoPlaying(bob, 'remote-video');

  await alice.getByRole('button', { name: 'Camera off' }).click();
  await expect(alice.getByText('Your camera is off')).toBeVisible();
  await expect(bob.getByText("Stranger's camera is off.")).toBeVisible();

  await alice.getByRole('button', { name: 'Mute' }).click();
  await expect(bob.getByText('Stranger is muted')).toBeVisible();

  // The tracks really are switched off at the source, not just hidden on screen.
  const enabled = await alice.getByTestId('local-video').evaluate((v: HTMLVideoElement) => {
    const stream = v.srcObject as MediaStream;
    return stream.getTracks().map((track) => track.enabled);
  });
  expect(enabled).toEqual([false, false]);

  await alice.getByRole('button', { name: 'Camera on' }).click();
  await alice.getByRole('button', { name: 'Unmute' }).click();
  await expect(bob.getByText("Stranger's camera is off.")).toHaveCount(0);
  await expect(bob.getByText('Stranger is muted')).toHaveCount(0);
  await expectVideoPlaying(bob, 'remote-video');
});

test('a camera switched off before matching is off for the new partner from the start', async ({
  browser,
}) => {
  const alice = await openPerson(browser);
  const bob = await openPerson(browser);

  await startButton(alice).click();
  await expectWaiting(alice);
  await alice.getByRole('button', { name: 'Camera off' }).click();

  await startButton(bob).click();
  await expectChatting(bob);

  await expect(bob.getByText("Stranger's camera is off.")).toBeVisible();
  await expectVideoPlaying(alice, 'remote-video'); // Alice still sees Bob
});

test('a blocked camera shows help instead of joining the queue', async ({ browser }) => {
  const alice = await openPerson(browser, () => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  const bob = await openPerson(browser);

  await startButton(alice).click();
  await expect(alice.getByText('Camera and microphone are blocked')).toBeVisible();

  // Alice never entered the queue, so Bob is left waiting.
  await startButton(bob).click();
  await expectWaiting(bob);

  await alice.getByRole('button', { name: 'Back' }).click();
  await expect(startButton(alice)).toBeVisible();
});

test('"Try again" works once the camera is allowed', async ({ browser }) => {
  const alice = await openPerson(browser, () => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let attempts = 0;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
        : original(constraints);
    };
  });

  await startButton(alice).click();
  await expect(alice.getByText('Camera and microphone are blocked')).toBeVisible();
  await alice.getByRole('button', { name: 'Try again' }).click();

  await expectWaiting(alice);
  await expectVideoPlaying(alice, 'local-video');
});

test('a device with no camera joins with audio only', async ({ browser }) => {
  const alice = await openPerson(browser, () => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    // Behave like a PC with a microphone but no webcam.
    navigator.mediaDevices.getUserMedia = (constraints) =>
      constraints?.video
        ? Promise.reject(new DOMException('No camera', 'NotFoundError'))
        : original(constraints);
  });
  const bob = await openPerson(browser);

  await startButton(alice).click();
  await expectWaiting(alice);
  await expect(alice.getByText('No camera found. You will join with audio only.')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Camera on' })).toBeDisabled();

  await startButton(bob).click();
  await expectChatting(alice);

  // Bob is told there is no picture, and still receives Alice's sound.
  await expect(bob.getByText("Stranger's camera is off.")).toBeVisible();
  await expect
    .poll(async () => (await videoInfo(bob, 'remote-video'))?.liveAudioTracks, { timeout: 15_000 })
    .toBe(1);
  // Alice sees Bob's camera.
  await expectVideoPlaying(alice, 'remote-video');
});

test('a device with no microphone at all is told what to do', async ({ browser }) => {
  const alice = await openPerson(browser, () => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('No devices', 'NotFoundError'));
  });

  await startButton(alice).click();
  await expect(alice.getByText('No microphone found')).toBeVisible();
});
