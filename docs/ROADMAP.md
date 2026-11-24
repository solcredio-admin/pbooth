# Roadmap: phases 11 to 13 (plans only, nothing here is built)

Written 2026-11-25. Sizes: S = a day or so, M = a few days, L = a week or more.

**Before phase 11:** phase 10 deployed; one real PayMongo test payment and refund; one real Telegram bot; one
print on the Canon G1010; the lockdown steps tried on one real booth. Any of these can change the plans below.

---

## Phase 11: the booth and the printer stop being one machine

### 11.1 Stations (L)

A **booth** is the camera side (kiosk, and the camera agent if it has a DSLR). A **station** is a print agent
with its printer, in its own **Stations** tab. Any kiosk can print to a station, an iPad included.

    event  <- many to many ->  booth  <- many to many, in order ->  station

Stations aren't linked to events: they follow the booths.

| Question | Plan |
|---|---|
| Which station prints? | Each booth has an ordered list; the first one that is online and ready gets the job. |
| All stations down | The job waits. The guest sees "your print is waiting" and keeps the QR; a Telegram alert goes out. After 30 minutes it expires and, if paid, is flagged for a refund. |
| Where does the guest collect it? | The done screen names the station. Shared stations print in order of arrival. |
| Printer settings (paper, printer name) | Move from the booth to the station. A booth only accepts stations with the paper its event needs. |
| Same computer for both | Still allowed: one agent can be a booth's camera and a station. |
| No internet | Kiosk and station on the same computer keep today's direct path, so prints still work. Any other pair needs internet; the job is sent when it returns. |
| Photo storage off | Remote printing needs it (the station downloads the print). Direct printing doesn't. |

**Never print twice.** This is the hardest part:
- A print's id stays the session id, and the agent's own queue already ignores an id it has seen.
- A station *claims* a job. Until it does, the server may offer the job to the next station. **After a claim the
  job never moves by itself**, because the first station may already be printing. Staff can move it by hand,
  with a warning.
- Moving an unclaimed job cancels it at the first station and is only final once the server has recorded it.

**Delivery:** agents ask every 2 seconds (today's 20-second check-in is too slow). The station downloads the
design the kiosk already uploads, so there is no second upload; only managed strips need their own print sheet.

**Moving over, with no re-enrolling:** the update makes one station from every booth that has printing on, with
the same settings, linked to that booth. Old agents keep printing directly until they're updated.

Built in this order, each usable alone:
1. Stations tab, linking, moving settings over. Printing unchanged. (M)
2. Print jobs through the server, with claims, waiting, and status on the kiosk. (L)
3. Several stations per booth, sharing, moving a job by hand. (M)

Done when: an iPad prints to a station in another room; two booths share one; unplugging a station moves waiting
jobs and nothing prints twice (tested by killing the agent at every step).

### 11.2 Remote booth control (M)

| Command | Runs on | Notes |
|---|---|---|
| Pause / resume ("Be right back" screen) | kiosk | never interrupts a guest mid-session; a paid guest finishes first |
| Reload the kiosk | kiosk | waits for the current session and unsent photos |
| Retry / move a print | station | from 11.1 |
| Restart the agent | agent | |
| What's on screen | kiosk | the screen's name, camera state and last error. **Not a picture of guests** |
| Update the agent | agent | last: it runs new code on booths. Only from this server, checked against a hash the server publishes, rolls back if the new version can't check in |

Commands expire after 2 minutes (a booth back from an outage doesn't obey old orders), are audited, and are for
the owner and booth admins. A picture of the idle screen could come later through the agent.

### 11.3 Boomerang GIF (M)

Short loop (forward and back) next to the photo in the guest's gallery; never printed.
- The kiosk keeps the last ~1.5 s of live view before each shot (about 12 frames, 640 px wide) and uploads the
  best one's frames through the existing outbox; **the server makes the GIF with Sharp, already in use**.
- DSLR live view runs at ~12 fps and stops for the shot, so its loop ends just before the photo.
- About 2-4 MB each: it counts toward storage and follows the same deletion date. Off by default, per event.
- Free self-service sessions have no gallery, so no GIF.

### 11.4 Telegram for everything (S)

Managed events (same rules, muted outside the event's times), failed backups, photo processing failures, storage
errors. Server up/down stays with Gatus, since pbooth can't report its own outage.

### 11.5 Support email on the help screen (S)

One address in Settings, shown on "Thanks" with the reference. Nothing is collected; the guest writes first.
Needs the address.

**Order:** 11.5 -> 11.4 -> 11.1 -> 11.2 -> 11.3. The two small ones are useful on day one; the GIF is last because
nothing depends on it.

---

## Phase 12: sell more, run out of nothing

### 12.1 Paper and ink (M) - first, the others depend on it
Counted per **station** (printers don't report it): sheets per pack, refill button with a count, one sheet off per
finished print. Low and empty alerts. At empty the booth offers only packages without prints, so nobody pays
for a print that can't come. Includes a "test print" that doesn't count as a sale.

### 12.2 Packages (L)
Per event: name, price, prints (0-5), digital yes/no, layouts allowed, order, on/off.
- The price is fixed by the server when the payment is made; changing a package never changes a past sale.
- Every event gets one "Standard" package with today's price, so nothing changes until a second is added.
- Vouchers are for one package (existing ones: Standard). With one package, the guest sees no extra screen.
- Reports, CSV and refunds show the package.

### 12.3 Extra prints (M)
On the done screen: "One more print, P50". Paid by QR only, so it needs the payment QR and the gallery QR on one
screen without confusion (shown one at a time). Each extra print is its own job with its own id, or the
never-twice rule would swallow it. Hidden when paper is low.

### 12.4 Locations dashboard (M)
Each location: today, week, failures, uptime, paper, open refunds, side by side. Uptime needs a small history of
online/offline, recorded from phase 11 on.

### 12.5 Venue statements (S)
Monthly PDF per location: sessions, gross, refunds, net, share. Made from the same numbers as the CSV. A closed
month doesn't change: a later refund appears in the next one.

**Order:** 12.1 -> 12.2 -> 12.3 -> 12.5 -> 12.4. Before starting: are prices per package inclusive of any tax the
café or you must show?

---

## Phase 13 (proposal): other people run it too

Until now the owner does everything. This phase lets cafés and clients help themselves, and makes sure a bad day
can't take the business down.

### 13.1 Café partner login (M)
A read-only role for a café's owner: their location's sales, share, statements and booth status. No guests'
photos, no other locations, no settings. Cashiers stay as they are.

### 13.2 Bookings for managed events (L)
A public request form -> quote -> deposit by PayMongo link -> the event is created, with a booth reserved and clashes
refused. Reminders by email. This is the first feature that stores clients' personal details on purpose, so it
comes with a privacy notice, a deletion date and an export/erase button.

### 13.3 Design library (M)
Your own overlays (PNG with transparent windows), saved looks, and a schedule ("Christmas, 1-31 December"), reused
across events instead of set up each time.

### 13.4 Bad-day readiness (M) - recommended first
- **Restore drill:** one command that restores the newest backup onto `pbooth-dev` and checks it, monthly, with a
  Telegram result. Backups that were never restored are only a hope.
- **Offline vouchers:** a booth keeps a limited number of signed one-time codes it can accept without internet.
  Small risk: a code used at two offline booths; limited by binding each batch to one booth.
- **Second way in:** a written plan and tested steps for moving pbooth to another server.
- **Key rotation:** PayMongo, R2 and Telegram keys changed without downtime, and a list of what each one can do.

### 13.5 Public status page (S)
"Is the booth at Kape Tayo working?" for cafés, without logging in.

**Left out on purpose:** guest accounts and marketing lists, a native app, selling pbooth to other companies (it
would need separate data per company: a rebuild, not a feature), AI backgrounds.

**Order:** 13.4 -> 13.1 -> 13.3 -> 13.2 -> 13.5.

## Questions

**Phase 11:** (1) Is "first ready station in a fixed order" right, or should jobs spread evenly? (2) Is 30 minutes
the right wait before a stuck paid print is flagged? (3) GIF on managed events, self-service, or both? (4) The
support email address.

**Phase 12:** (5) Tax on prices? (6) Can a voucher be upgraded by paying the difference, or only used for its package?

**Phase 13:** (7) Do cafés want a login, or is a monthly PDF enough? If enough, drop 13.1. (8) Do clients book
often enough that 13.2 saves real time?
