# Pilot event checklist

A short, printable list for running a real event with pbooth. Tick it top to bottom.

## A week before

- [ ] **Event set up:** name, date and times on the venue's clock, venue, client (Events → the event → *Event* tab).
- [ ] **Guest screen:** welcome title and message, countdown, photos per guest (*Guest screen* tab).
- [ ] **Photo design:** layout (4R landscape, or 2×6 strips two-per-sheet), colours, pattern, frame, footer text. Check the preview (*Photo design* tab).
- [ ] **Prints & gallery:** printing on/off and copies; QR gallery on; how many days photos are kept; designs only or every photo (*Prints & gallery* tab).
- [ ] **Booth booked** on the event (sidebar → *Booths* → Book a booth).
- [ ] **Event scheduled** (sidebar → *Lifecycle* → Schedule).
- [ ] **Accounts:** anyone helping on the night has their own login with the right role (Settings → *Users*). A kiosk operator only needs *Kiosk operator*.
- [ ] **Backups:** Settings → *Backups* shows a backup from the last day. Press *Back up now* after big changes.

## Booth computer, the day before (at home)

- [ ] **Browser:** Chrome or Edge, up to date (Firefox works too). Full screen with F11; turn off sleep and screen saver.
- [ ] **Booth display** set to match the screen (Booths → the booth → *Hardware*: landscape 16:9 or portrait 9:16). If the camera is mounted sideways, set *Camera rotation*.
- [ ] **Kiosk opened** on that computer: sign in, Booths → the booth → *Open kiosk here* (or pair with a code from the *Connect* tab).
- [ ] **Camera check:** the live preview fills the screen, isn't zoomed, and the crop guide shows what the print keeps.
- [ ] **DSLR / printer (if used):** the booth agent is enrolled (*Connect* → Booth agent) and the sidebar shows camera and printer *connected*.
- [ ] **Test print** of the actual layout on the actual paper. For strips, check the cut marks line up with the middle of the sheet.
- [ ] **Offline test:** unplug the network, take a guest session, plug it back in. The *Syncing* badge should count down to zero and the photos appear in the event gallery.

## At the venue

- [ ] Power for the computer, camera, printer and lights; a spare extension lead.
- [ ] Internet: venue Wi-Fi or a phone hotspot. pbooth keeps working without it and uploads later.
- [ ] Open the kiosk and do **one full test session**: tap *Strike a pose*, let the 10-second instructions run, take the photos, approve, scan the QR on your own phone.
- [ ] **Event activated** (sidebar → *Lifecycle* → Go live). The booth shows *Live at …* on its page.
- [ ] Printer: paper and ink loaded, a spare pack nearby.

## During the event

- [ ] Live view (event → *Open live view*) shows the booth online and sessions counting up.
- [ ] Gatus / Telegram alerts quiet. If pbooth.solcredio.net goes down, the booth keeps taking photos; they upload when it's back.
- [ ] If the kiosk shows *Syncing · N waiting* for a long time, check the booth's internet.

## After the event

- [ ] **Wrap up** the event (sidebar → *Lifecycle* → Wrap up).
- [ ] Gallery & export: download the ZIP for the client; share the event gallery link if wanted.
- [ ] Check the photo count matches what the booth took (live view totals).
- [ ] Take the booth off the event if it won't be used again soon.
- [ ] Photos are deleted automatically after the retention period; the event itself stays on record.

## If something goes wrong

| Problem | What to do |
|---|---|
| Kiosk shows the pairing screen | Sign in on that computer → booth → *Open kiosk here* |
| Camera not found | Replug the USB camera; the kiosk retries by itself. Check the browser allowed the camera |
| Preview zoomed / wrong way round | Booth → *Hardware*: booth display, camera rotation, mirror preview |
| Photos not uploading | The kiosk keeps them; they upload when the internet returns. Don't clear the browser's data |
| Locked out of pbooth | On Stravex: `docker compose exec app sh -c "cd /app/api && node dist/cli.js admin:reset-password"` (add `--username <name>` for someone else) |
| Need to undo a mistake in the data | Settings → *Backups*, then `backup:restore` on the server (it saves a safety copy first) |
