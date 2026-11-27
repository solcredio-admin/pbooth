# Roadmap: phases 11 to 13 (plans; what's built says so)

Written 2026-11-25. Sizes: S = a day or so, M = a few days, L = a week or more.

**Grouped by who it's for** (owner's call, 2026-11-27): first everything only managed events need, then what
both kinds of event use, then everything self-service needs. Within a phase: smallest change first, unless one
needs another. Points (S = 1, S-M = 2, M = 3, L = 6) show how much code each phase is; they're estimates.

| Phase | For | Points |
|---|---|---|
| 11 | Managed events | done |
| 12 | Both | 15 |
| 13 | Self-service | 21, + 6 for bookings (moved here) |

Phase 13 is the biggest: split it in two when it starts if it's too long to ship at once.

**Before phase 11:** phase 10 deployed; one real PayMongo test payment and refund; one real Telegram bot; one
print on the Canon G1010; the lockdown steps tried on one real booth. Any of these can change the plans below.

---

## Phase 11: managed events

Stations (11.1) is done and serves both kinds of event; it stays here because it was built first.

### 11.1 Stations (L) - built and deployed 2026-11-25

Changed while building (owner's call): each booth is **fixed** (backups print only when the main one can't, not when
it's busy) or **rotates**. The main case is many booths on one printer: one line, oldest first, that recovers by
itself. A station asks before it prints, so a job it hadn't started can move by itself; after that only staff move
it, unless the agent is certain nothing came out. Not built: refusing stations whose paper the event can't use.

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

### 11.2 Design library (M) - built and deployed 2026-11-27: your own frames per layout, with templates
Your own overlays (PNG with transparent windows), saved looks, and a schedule ("Christmas, 1-31 December"), reused
across events instead of set up each time.

**Done 2026-11-27.** Bookings moved to the end of phase 13 (13.9): it needs the PayMongo live account.

---

## Phase 12: both kinds of event

### 12.1 Telegram for everything (S) - built 2026-11-27, not deployed

Built: reminders at most daily; a booth silent for a day is parked (closes quietly); managed events alert from an
hour before they start until they end; a new "Backups, photos, storage" kind (no backup in 26 hours, storage not
answering, photos that failed processing in the last hour), checked every 10 minutes and added to existing chats.

**Fix first (seen 2026-11-27):** a booth that stays offline is repeated every hour with "(still happening)", all day
(two test booths offline since the morning filled the chat from 09:40 to 17:44). Send a problem once, then at most
a short daily reminder, or only when it changes; never repeat while the event isn't running or is outside its hours;
a booth unused for a day is "parked", not an alert.

Managed events (same rules, muted outside the event's times), failed backups, photo processing failures, storage
errors. Server up/down stays with Gatus, since pbooth can't report its own outage.

### 12.2 Audit log in Settings (S-M) - built 2026-11-27, not deployed

Built: Settings → Audit log for the owner and super admins, with account (name and role kept with each entry), kind,
dates, guests on request, old → new values for events, booths, stations and users (secrets only as "changed"),
CSV, and History links on event, booth and station pages. Kept a year; money and account entries for good.
Not built: the test that catches a change endpoint that records nothing.

Who changed what, and when. The server has recorded most changes since phase 1 (the `AuditLog` table: account, action,
what it was done to, IP); nothing shows it yet.

- **Settings -> Audit log**, owner only, read-only: nobody can edit or delete entries from the app.
- Each line: time, **account name and role**, a plain sentence ("edited booth Booth A"), IP. Booths, stations,
  kiosks, guests and the system are named too. Accounts are stored by id today: keep the username with each new entry,
  so a deleted or renamed account still reads correctly.
- **What changed:** entries list only the changed fields today. Store old -> new values for events, booths, stations,
  users, prices and alert settings. Never passwords, PINs, codes, tokens or a logo's image.
- Filters: account, kind (events, booths, stations, users, money, sign-ins), date, and "this item"; CSV download.
  Event, booth and station pages link to their own history.
- Check every change is recorded (backups, restore, storage, photo deletions, galleries, retention) and add a test
  that fails when a new change endpoint records nothing.
- Guest actions (voucher tries, pairing) are noisy: hidden until asked for.
- To decide: how long to keep it (proposed: 1 year; money and user changes for good).

### 12.3 User roles (M) - built 2026-11-27, not deployed

Built as the table below, with the four proposed answers: event admins book booths and keep galleries; cashiers
make vouchers and give replacement vouchers; super admins refund money; sales admins don't see photos.

| | Owner | Super admin | Event admin | Hardware admin (was Booth admin) | Sales admin (new) | Kiosk admin (was Kiosk operator) | Cashier |
|---|---|---|---|---|---|---|---|
| Users and roles | manage | no | no | no | no | no | no |
| Settings, backups, storage, alerts | manage | manage | no | no | no | no | no |
| Events | manage | manage | manage | see | see | **assigned only**, see | **assigned only**, see |
| Booths and stations (and stuck prints) | manage | manage | see | manage | see | only to open the kiosk | no |
| Sales tab | all | all | no | no | see all | no | no |
| Vouchers of an event (make, print, void) | all | all | **all** | no | see | no | **assigned only** (question 2) |
| Sales of one event (money totals) | all | all | no | no | see | no | **assigned only** |
| Refund and help requests | all | all | no | no | see | no | **assigned only** (question 2) |
| Open a booth's kiosk | yes | yes | no | yes | no | **assigned events only** | no |

- **On each event, two pickers:** which kiosk admins may open its kiosks, and which cashiers may see its vouchers and
  sales. Several people each; an account can be on several events. Nobody assigned = only owner and super admin (and
  hardware admins, for the kiosk). The cashier list exists already (`EventCashier`); kiosk admins get the same kind.
- An event admin's voucher list shows each code's state (unused, used, void, expired) but no money totals, and the
  Sales tab stays hidden.
- A kiosk admin signs in to a short list of their events and the booths on them, with one button: open the kiosk.
  Nothing else in the menu. The server refuses a booth that isn't on one of their events.
- **Moving over:** today's "Super admin" accounts (`OWNER`) stay Owner, so nobody loses access. Booth admins become
  Hardware admins and kiosk operators Kiosk admins by name only. **Kiosk operators then see nothing until they're
  assigned**: assign them in the same update. At least one active owner must always exist (already enforced).
- Enforced by the server on every request, as now; hidden menus are only for tidiness. Live updates and CSV exports
  follow the same rules. Every role change goes into the audit log (12.2).
- Test: one table of role x action, generated from the one above, so a new endpoint can't be forgotten.

What gets taken away compared to today: event admins lose the Sales tab, event sales totals and refunds (they
keep vouchers); cashiers can no longer edit, start or end their event; kiosk operators no longer see every event and booth.

**To decide:** (1) may an event admin put a booth on an event (booking, not managing it)? Proposed: yes. (2) Do
cashiers still make vouchers and hand out replacement vouchers? Proposed: yes, for their event; refunds of money stay
with owner and super admin. (3) May a super admin refund money? Proposed: yes. (4) Does an event admin see event
galleries and photos? Proposed: yes, as today; sales admin: no.

### 12.4 Remote booth control (M)

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

### 12.5 Boomerang GIF (M)

Short loop (forward and back) next to the photo in the guest's gallery; never printed.
- The kiosk keeps the last ~1.5 s of live view before each shot (about 12 frames, 640 px wide) and uploads the
  best one's frames through the existing outbox; **the server makes the GIF with Sharp, already in use**.
- DSLR live view runs at ~12 fps and stops for the shot, so its loop ends just before the photo.
- About 2-4 MB each: it counts toward storage and follows the same deletion date. Off by default, per event.
- Free self-service sessions have no gallery, so no GIF.

### 12.6 Bad-day readiness (M)
- **Restore drill:** one command that restores the newest backup onto `pbooth-dev` and checks it, monthly, with a
  Telegram result. Backups that were never restored are only a hope.
- **Offline vouchers:** a booth keeps a limited number of signed one-time codes it can accept without internet.
  Small risk: a code used at two offline booths; limited by binding each batch to one booth.
- **Second way in:** a written plan and tested steps for moving pbooth to another server.
- **Key rotation:** PayMongo, R2 and Telegram keys changed without downtime, and a list of what each one can do.

**Order:** as listed. The audit log comes before the roles, so the role changes are recorded; the GIF needs
nothing else, so it can move; bad-day readiness closes the phase, once everything it must restore exists.

---

## Phase 13: self-service

### 13.1 Support email on the help screen (S)

One address in Settings, shown on "Thanks" with the reference. Nothing is collected; the guest writes first.
Needs the address.

### 13.2 Public status page (S)
"Is the booth at Kape Tayo working?" for cafés, without logging in.

### 13.3 Venue statements (S)
Monthly PDF per location: sessions, gross, refunds, net, share. Made from the same numbers as the CSV. A closed
month doesn't change: a later refund appears in the next one.

### 13.4 Paper and ink (M)
Counted per **station** (printers don't report it): sheets per pack, refill button with a count, one sheet off per
finished print. Low and empty alerts. At empty the booth offers only packages without prints, so nobody pays
for a print that can't come. Includes a "test print" that doesn't count as a sale.

### 13.5 Locations dashboard (M)
Each location: today, week, failures, uptime, paper, open refunds, side by side. Uptime needs a small history of
online/offline, recorded from phase 11 on.

### 13.6 Extra prints (M)
On the done screen: "One more print, P50". Paid by QR only, so it needs the payment QR and the gallery QR on one
screen without confusion (shown one at a time). Each extra print is its own job with its own id, or the
never-twice rule would swallow it. Hidden when paper is low.

### 13.7 Café partner login (M)
A read-only role for a café's owner: their location's sales, share, statements and booth status. No guests'
photos, no other locations, no settings. Cashiers stay as they are.

### 13.8 Packages (L)
Per event: name, price, prints (0-5), digital yes/no, layouts allowed, order, on/off.
- The price is fixed by the server when the payment is made; changing a package never changes a past sale.
- Every event gets one "Standard" package with today's price, so nothing changes until a second is added.
- Vouchers are for one package (existing ones: Standard). With one package, the guest sees no extra screen.
- Reports, CSV and refunds show the package.

### 13.9 Bookings for managed events (L) - moved last 2026-11-27

Waits for the PayMongo live account (business permits first): the deposit link needs it.
A public request form -> quote -> deposit by PayMongo link -> the event is created, with a booth reserved and clashes
refused. Reminders by email. This is the first feature that stores clients' personal details on purpose, so it
comes with a privacy notice, a deletion date and an export/erase button.

**Left out on purpose:** guest accounts and marketing lists, a native app, selling pbooth to other companies (it
would need separate data per company: a rebuild, not a feature), AI backgrounds.

**Order:** as listed. Paper and ink comes before the locations dashboard, extra prints and packages: they need its
counts. Extra prints is built so packages can take over its price later. The café login needs the roles (12.3)
and shows the venue statements (13.3). Before starting: are prices inclusive of any tax the café or you must show?

## Questions

**Phase 11 (managed):** (1) Do clients book often enough that bookings (13.9) saves real time?

**Phase 12 (both):** (2) The boomerang GIF on managed events, self-service, or both? (3) The four open questions
under user roles (12.3). (4) How long to keep the audit log (12.2)?

**Phase 13 (self-service):** (5) Is 30 minutes the right wait before a stuck paid print is flagged for a refund?
(6) The support email address. (7) Tax on prices? (8) Can a voucher be upgraded by paying the difference, or only
used for its package? (9) Do cafés want a login, or is a monthly PDF enough? If enough, drop 13.7.

Answered: stations print from a fixed list with backups, or rotate, per booth (11.1).
