# Bitsomeggle — Manual Tests

Things only a person with real devices can check. Automated tests use a pretend camera,
so they prove the app's logic, not that a real camera, microphone and speaker work.

**How to use this file:** do the steps, compare with "You should see", and tell Claude the
result for each numbered test: ✅ worked, or ❌ plus what you saw instead. An item is only
marked **Confirmed** once you report it.

| Status | Meaning |
|---|---|
| Needs manual test | Not yet tried by a person |
| Confirmed | You tried it and it worked |
| Failed | You tried it and it did not work (details noted) |

---

## M4 — Video and audio on one laptop

**Setup**
1. In the project folder run `npm run dev` and wait for both "server" and "web" lines.
2. Use **Chrome or Edge**. Open http://localhost:5173 in a normal window (**window A**).
3. Open http://localhost:5173 in an **incognito/InPrivate** window (**window B**). Put the
   two windows side by side.
4. **Wear headphones, or turn your speaker volume low.** Both windows use the same
   microphone and speaker, so without headphones you will get a loud echo or squeal.
   That squeal is expected with two windows on one machine and is not a bug.

If a step fails, also press `F12` in that window, open the **Console** tab, and copy any
red lines.

### M4-1 Camera permission and preview — _Confirmed (2026-11-14)_
1. In window A press **Start chatting**.
2. If the browser asks to use your camera and microphone, click **Allow**.

You should see: "Looking for someone…" with **your own camera picture above it**,
mirrored (raise your right hand, the picture's hand on the right side goes up). Your
laptop's camera light is on.

### M4-2 Two windows connect with video and sound — _Confirmed (2026-11-14)_
1. In window B press **Start chatting** and allow the camera.

You should see, within about 3 seconds, in **both** windows:
- A large picture of the other window's camera (the same camera, so the same view of you,
  **not** mirrored).
- Your own small mirrored picture in the bottom-right corner.
- No "Connecting video…" text left on the picture.

Then tap your microphone or speak: you should hear yourself through the headphones with a
slight delay. That delay is the sound travelling A → B.

Note: some laptops only let one program use the camera at a time. If window B shows
"Your camera or microphone is busy", report that; it is useful to know.

### M4-3 Mute and camera buttons — _Confirmed (2026-11-14)_
1. In window A press **Camera off**.
2. In window A press **Mute**.
3. Press **Camera on** and **Unmute** again.

You should see:
- After step 1: window B shows "Stranger's camera is off." Window A's small picture shows
  "Your camera is off". The camera light may stay on; that is normal (see note below).
- After step 2: window B shows a "Stranger is muted" label, and you no longer hear
  yourself.
- After step 3: picture and sound are back, and both labels are gone.

Note: "Camera off" stops sending your picture but keeps the camera ready so it can come
back instantly. The light goes out fully when you press Leave.

### M4-4 Next and "Stranger moved on" — _Confirmed (2026-11-14)_
1. In window A press **Next**.

You should see: window A shows "Looking for someone…" with your preview. Window B shows
"Stranger moved on. Press Next to meet someone new." and still shows its own small picture.

2. In window B press **Next**.

You should see: both windows are connected again with video, and the text chat is empty.
Neither page reloaded (no white flash, no second permission prompt).

### M4-5 Leave switches the camera off — _Confirmed (2026-11-14)_
1. In window B press **Leave**. Then in window A press **Leave**.

You should see: both windows are back on the landing page, and **the laptop's camera light
goes off** a moment after the second Leave. If the light stays on for more than a few
seconds with both windows on the landing page, report it.

### M4-6 Text chat during a call — _Confirmed (2026-11-14)_
1. Start a chat in both windows again.
2. Type a message in A and press Enter. Reply from B.

You should see: each message appears in both windows, on the right ("You") for the sender
and on the left ("Stranger") for the receiver, while video keeps playing.

### M4-7 Blocked camera shows help — _Confirmed (2026-11-14)_
1. In window B, click the icon at the left of the address bar (a camera, lock or sliders
   icon), set **Camera** to **Block**, and reload the page.
2. Press **Start chatting**.

You should see: a screen titled "Camera and microphone are blocked" with instructions,
and **Back** / **Try again** buttons. Window B is not put in the queue.

3. Set Camera back to **Allow** in the same menu, then press **Try again**.

You should see: "Looking for someone…" with your camera preview.

### M4-8 Narrow window (phone-like layout) — _Confirmed (2026-11-14)_
1. During a call, drag the window narrower than about 800 pixels (or press `F12` and click
   the phone/tablet icon).

You should see: the video on top and the text chat underneath, with Mute, Camera, Leave
and Next in one row. Nothing overlaps or is cut off.

---

## M5 — The deployed site

Do these after following [DEPLOYMENT.md](DEPLOYMENT.md). Below:
- **web address** = the Vercel one, https://bitsomegle-claude.vercel.app
- **server address** = the Render one, https://bitsomeggle.onrender.com

**M5-1 to M5-4 need only your laptop** and take about five minutes. Do them straight after
deploying. The rest need a phone, a second network and a friend.

### M5-1 The server is alive — _Confirmed (2026-11-14, checked by Claude)_
1. Open https://bitsomeggle.onrender.com/health in a browser tab. Use the **server** address: the web address
   has no such page and shows Vercel's "This page doesn't exist" instead.

You should see: `{"status":"ok","app":"Bitsomeggle"}`. If the server was asleep this can
take up to a minute the first time.

### M5-2 The site connects and a call works — _Confirmed (2026-11-14)_
1. Open the web address in a normal window and in an incognito window. Wear headphones.
2. Wait for **Start chatting** to become clickable in both, then press it in both.
3. Send a text message each way.

You should see: video both ways and both messages delivered, as on your laptop in M4.
Report: how long the Start button took to become clickable.

### M5-3 The relay works — _Confirmed (2026-11-14)_
This is the most important M5 test. It proves the Cloudflare TURN key is working.
1. Press Leave in both windows.
2. In the incognito window, change the address to `<web address>/?relay=1` and press Enter.
3. Press **Start chatting** in both windows.

You should see: video both ways, perhaps a second or two slower to appear than in M5-2.
If instead the window says "Couldn't connect video", the relay is **not** working: tell
Claude, and include what M5-4 shows.

### M5-4 The server log looks right — _Confirmed (2026-11-14)_
1. In Render, open the `bitsomeggle` service and its **Logs** tab.
2. Find the lines listed under "You should see" and copy them to Claude (they contain no
   personal data).

You should see:
- `TURN credentials refreshed`
- `Bitsomeggle server listening` with `"turnRelay":true` and `"perIpCap":500`
- `address headers on the first connection (names only)` followed by a list that
  includes `true-client-ip`

You should **not** see: `visitor address not found`, any IP address, or any of the chat
text you typed in M5-2.

### M5-5 Phone ↔ laptop on the same Wi-Fi — _Confirmed (2026-11-14)_
1. Laptop: open the web address, press Start. Use headphones on the laptop.
2. Phone (on the same Wi-Fi): open the web address in Chrome (Android) or Safari
   (iPhone), allow camera and microphone, press Start.

You should see: video and sound both ways. On the phone, the video is on top and the text
chat underneath; Mute, Camera, Leave and Next are all reachable with a thumb.
Report: phone model and browser, and anything that looks cut off or too small.

### M5-6 Two different networks — _Confirmed (2026-11-14)_
1. Laptop on campus Wi-Fi (or home Wi-Fi). Phone with **Wi-Fi switched off**, on mobile data.
2. Start on both.

You should see: video and sound both ways within about 10 seconds.

### M5-7 Campus Wi-Fi through the relay — _Confirmed (2026-11-16)_
Checks that the campus firewall lets relayed calls through.
1. Both devices on **campus Wi-Fi**.
2. On one of them open `<web address>/?relay=1`. Start on both.

You should see: video and sound both ways. If this fails but M5-3 worked from elsewhere,
the campus network is blocking the relay: tell Claude, it changes what we do next.

### M5-8 Other browsers — _Confirmed (2026-11-16)_
Repeat M5-2 with one side in each of these, as far as you have them:
- Firefox on the laptop
- Safari on an iPhone
- Chrome on an Android phone
- Safari on a Mac

Report per browser: ✅, or what went wrong. Known thing to watch on iPhone: sound may
only start after you touch the page once.

### M5-9 A real second person — _Confirmed (2026-11-16)_
1. Ask a friend in another room or another hostel to open the web address. Both press Start.
2. Talk for two minutes. Try Mute, Camera off, a few text messages, and Next (you will be
   matched with each other again, because nobody else is online).

Report: can you both hear clearly? Is there an echo of your own voice (which side hears
it)? How long is the delay between speaking and being heard, roughly? Is the picture
smooth or does it freeze?

### M5-10 Sleep and wake — _Confirmed (2026-11-16)_
1. Close every Bitsomeggle tab and leave the site alone for at least 20 minutes.
2. Open the web address.

You should see: "Connecting… If the server was asleep, this can take up to a minute.",
then the Start button becomes clickable by itself, without reloading the page.
Report: roughly how long it took.

---

## M6 — Reliability on real networks

Do these on the live site **after the latest version has been pushed and Render shows it
as Live**. To be sure you are testing the new version, reload the page on both devices
first. Use two devices where it says so; a phone and a laptop are ideal.

Automated tests cut the connection in a simulated way. Only these tests show what real
Wi-Fi and mobile networks do.

### M6-1 A short Wi-Fi blip — _Confirmed (2026-11-16, second try, after the fix in D-042)_
> First try: the banner appeared, then the start page with "Your connection dropped, so
> the chat ended." Cause: the server had not noticed the drop (DECISIONS D-042).
1. Start a call between a laptop and a phone.
2. On the laptop, switch Wi-Fi **off**, count to three, switch it **on** again.

You should see, on the laptop: an orange "Connection lost. Reconnecting…" banner, and the
picture freezing or showing "Connecting video…". Within about 15 seconds of Wi-Fi being
back, the banner disappears and video and sound return **in the same chat**: your earlier
text messages are still there.
On the phone: the picture freezes and then recovers. It must **not** say "Stranger
disconnected."
Report: roughly how many seconds until video was back, and what each screen showed.

### M6-2 Phone switches from Wi-Fi to mobile data — _Confirmed (2026-11-16, second try, after the fix in D-042)_
> First try: same result and same cause as M6-1.
1. Start a call with the phone on Wi-Fi (mobile data also enabled).
2. On the phone, switch Wi-Fi off, so it falls back to mobile data.

You should see: as M6-1. The call continues over mobile data in the same chat.
Report: seconds until video was back; phone model and browser.

### M6-3 A long drop — _Confirmed (2026-11-16)_
1. Start a call between two devices.
2. On one of them switch Wi-Fi off and leave it off for **30 seconds**. Then switch it on.

You should see, on the other device: after about 10 to 30 seconds, "Stranger disconnected.
Press Next to meet someone new."
On the device that was offline: once it is back online, the start page with "Your
connection dropped, so the chat ended.", and the camera light off.

### M6-4 Closing the tab — _Confirmed (2026-11-16)_
1. Start a call between two devices (or two windows).
2. Close the tab on one of them.

You should see, on the other: "Stranger left." within about two seconds.
(If it takes about 10 seconds and says "Stranger disconnected." instead, tell Claude which
browser closed the tab: that browser didn't get its goodbye out.)

### M6-5 The server restarts — _Needs manual test_
1. Open three windows. Start a call between two; press Start in the third so it shows
   "Looking for someone…" (it stays waiting, because the other two are busy).
2. In Render, open the `bitsomeggle` service and choose **Manual Deploy → Restart service**.

You should see: all three show "Connection lost. Reconnecting…" for up to a minute or two.
Then the two that were in a call show the start page with "Your connection dropped, so the
chat ended.", and the third goes back to "Looking for someone…" **by itself**, without
you pressing anything.

### M6-6 Load test on the live server — _Confirmed (2026-11-16, run by Claude at your request)_
> Result: 300 of 300 connected, nothing refused or unanswered, 95% of answers within
> 115 ms. Render's log for those minutes: `loopDelayP99Ms` 1 to 2, memory up to 123 MB
> (DECISIONS D-043).
This decides whether Render's free plan is enough. It connects 300 pretend users for two
minutes. **Real visitors online at that moment would be matched with them**, so pick a
time when nobody is expected.
1. Tell Claude when to run it, or run it yourself from the project folder:
   `npm run loadtest -- --url https://bitsomeggle.onrender.com --clients 300 --seconds 120`
2. Afterwards, in Render's **Logs**, find the lines ending in `"msg":"stats"`.

You should see: "users connected 300 of 300", no refused or unanswered requests, and
answer times under about 300 ms at p95. In the log, `loopDelayP99Ms` under about 100.
Report: the two tables the tool prints, and the stats lines from the log.

---

## M7 — Reporting, the landing page and phone use

Do these on the live site **after M7 has been pushed and Render shows the new version as
Live**. Reload the page on every device first.

### M7-1 Report and skip — _Needs manual test_
1. Start a call between two devices (A and B).
2. On A, press **Report** (top right of the other person's video). Choose any reason.

You should see, on A: "Looking for someone…" and "Thanks, your report was noted. You won't
be matched with that person again."
On B: "Stranger moved on. Press Next to meet someone new." Nothing on B may mention a report.
3. On B press **Next**.

You should see: both A and B stay on "Looking for someone…" and are **not** matched with
each other, although they are the only two people waiting.
4. Press Cancel on both to finish.

### M7-2 Reporting someone who left first — _Needs manual test_
1. Start a call between A and B. On B press **Next**.
2. On A (which shows "Stranger moved on.") press **Report** and choose a reason.

You should see, on A: "Stranger moved on. Report sent, thank you." and the button now
says **Reported** and cannot be pressed again.

### M7-3 The report dialog on a phone and with a keyboard — _Needs manual test_
1. On a phone, during a call, press **Report**.

You should see: a box in the middle of the screen with four reasons and Cancel, all easy
to tap, nothing cut off. Tapping **Cancel** closes it and the call continues.
2. On a laptop, during a call, press **Report**, then press the **Escape** key.

You should see: the box closes and the call continues. Pressing **Tab** moves through the
buttons inside the box and never to the page behind it.

### M7-4 Three reports block someone for a while — _Needs manual test_
You need four browser windows (for example two normal and two private windows on two
devices). Call one of them the offender.
1. Start a call between the offender and window 1. In window 1, **Report**, then **Cancel**.
2. On the offender press **Next**. Start in window 2, **Report** from window 2, **Cancel**.
3. On the offender press **Next**. Start in window 3, **Report** from window 3.

You should see, on the offender, right after the third report: the start page with
"Several people reported you, so you can't start a chat for a few minutes." and the camera
light off. Pressing **Start chatting** shows the same message again.
4. Reload the offender's page and press Start.

You should see: it works again. This is the known limit: without accounts, a reload
clears the block (DECISIONS D-045).

### M7-5 The landing page — _Needs manual test_
1. Open the site on a phone and on a laptop.

You should see: the Start button, a line saying how many people are here, and four short
rules under "Before you start". On the phone everything is readable without zooming, and
the Start button is visible without scrolling.
2. With the laptop page open, open the site on the phone too and wait up to 15 seconds.

You should see: the laptop's line change from "You're the only one here right now." to
"2 people here right now".
Report: is the wording of the rules what you want? Should it mention an age limit?

### M7-6 Typing on a phone — _Needs manual test_
1. On a phone, during a call, tap the message box so the on-screen keyboard opens.
2. Type a message and send it.

You should see: the message box stays visible above the keyboard while you type, and the
sent message appears in the list.
Report: phone model and browser, and whether the box was hidden by the keyboard.

### M7-7 Waiting alone — _Needs manual test_
1. Make sure no other window is open. Press **Start chatting**.

You should see: "Looking for someone…" and "Nobody else is online right now. Stay here and
you'll be matched when someone arrives."
