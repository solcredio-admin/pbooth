# Self-service booths: design draft

Status: **phase 8 built** (self-service events, vouchers, free sessions, revenue share, cashiers).
**Phase 9 built**: PayMongo QR payments (thermal receipt printing dropped). **Phase 10 built** (2026-11-25): unattended reliability, see section 11. Decisions so far: ₱150 per
paid session (includes prints); vouchers belong to one event and are managed in its Vouchers tab;
free-session events print nothing (QR only); the owner makes unlimited free-session codes; cashiers
log in and run only their assigned events; boot/shutdown is handled by your RMM tool (no opening
hours in pbooth). pbooth today runs **managed events**: a date, a
client, a booth you set up and watch over. This adds a second kind: a **self-service location**, a
booth left running indefinitely (a café, a mall, a hotel lobby) where guests pay and use it on
their own, while you manage and monitor it remotely.

Both kinds use the same events, booths, bookings, kiosk, designs, galleries, storage, users and
backups. Self-service adds opening hours, prices, payments and vouchers on top.

## 1. Two kinds of event

| | Managed event (today) | Self-service location (new) |
|---|---|---|
| Example | Reyes–Santos Wedding, Sat 3–11 pm | Kape Tayo Café, BGC |
| Runs | One date, start to end | Indefinitely, during opening hours |
| Guests pay | No (the client paid you) | Yes, per session: QR payment or a voucher |
| Who's there | You or an operator | Nobody; staff only sell vouchers and refill paper |
| Lifecycle | Draft → Scheduled → Live → Wrapped → Archived | Draft → Open ⇄ Paused → Closed (archived) |
| Design | Set per event | Set per location; can be changed any time (e.g. seasonal frames) |
| Reports | Sessions and photos for the event | Daily sessions, revenue, vouchers, uptime, paper |

In the data, an event gets a `kind`: `MANAGED` (every event today) or `SELF_SERVICE`. Everything
that works for events today keeps working for both kinds.

## 2. Booths and booking (same as today)

- A booth is booked onto a self-service location exactly like onto an event (Booths → Events tab,
  or the event's Booths). While the location is **Open**, the booth serves it.
- The current rule stays: **a booth serves one live event at a time**. An open location counts as
  live, so a booth at the café can't also be live at a wedding. To take it to a wedding, **pause**
  the location (or move the booth), then book it on the wedding.
- A location can have more than one booth (a big mall); each booth reports separately.
- The booth page shows which location it serves, and its health as today (agent, kiosk, camera,
  printer, uploads).

## 3. The guest's experience (kiosk)

```
Attract screen ─tap→ Choose a package ─→ Pay ─→ Get ready (10 s) ─→ Shoot ─→ Review ─→ Print + QR ─→ Thank you
   (loops a            (e.g. 1 strip ₱150,    QR code, or            same as today                                  back to attract
    sample video        2 prints ₱250)        enter a voucher
    or photos)
```

- **Attract screen** when idle: the location's welcome title, sample photos, price, "Tap to start".
- **Packages**: up to 3, each with a price, number of prints, layout (4R or strips) and whether
  digital copies are included. One package can be free (staff tests, promos).
- **Pay** (one screen, both methods side by side):
  - **Scan to pay**: a QR code for the exact amount. When the payment provider confirms it, the
    screen moves on by itself (usually a few seconds). The QR expires after ~5 minutes.
  - **Have a voucher?**: type the code from the cashier; it's checked and used once.
- **Payment never blocks forever**: Cancel is always there; an unpaid session times out and returns
  to the attract screen.
- **Out of hours**: a "We're closed, open again at 10:00" screen; nothing can be paid or shot.
- **Out of paper / printer error**: the booth stops taking payment and shows "Temporarily
  unavailable" (so nobody pays for a print they won't get), and you get an alert.

## 4. Payments

### 4a. QR payment (automatic)

- Through a payment provider that supports **QR Ph** (one QR that works with GCash, Maya and bank
  apps), for example **PayMongo**, Xendit or Maya Business. pbooth never sees card or bank details.
- Flow: kiosk asks the API for a payment → API creates a payment intent with the provider for the
  package price (the price always comes from the server, never from the kiosk) → kiosk shows the
  QR → the provider calls pbooth's **webhook** when it's paid → API marks the session paid → kiosk
  moves on.
- Webhooks are verified by signature and are idempotent (a repeated notice doesn't pay twice).
- Needs internet at the moment of payment. If the booth is offline, the QR option is hidden and
  vouchers still work.
- Refunds are done in the provider's dashboard; pbooth records them for reports.

### 4b. Vouchers (paid at the cashier)

- You (or a future *Cashier* role) generate a **batch** of vouchers in pbooth: how many, which
  package, which location (or any), and an expiry date.
- Each voucher is a short code like `7K3M-Q9TX` (the same easy-to-read alphabet as booth codes),
  printable as a sheet of cards with a QR the booth camera could also scan later.
- The cashier sells one with the coffee; the guest types it at the booth.
- **One use only**, checked by the server. Codes are stored hashed; guessing is rate-limited.
- **Offline**: the booth keeps a list of the location's unused voucher hashes, so a voucher still
  works without internet; redemptions sync later. (With one booth per location this can't be used
  twice; with several booths, the rare offline double-use is flagged in reports.)
- Reports: sold vs used, by batch, by day; void a lost batch in one click.

## 5. What you see as the owner

- **Location page** (same layout as an event page): header with Open/Paused/Closed and today's
  numbers; tabs for *Location*, *Guest screen*, *Photo design*, *Packages & prices*, *Payments*,
  *Vouchers*, *Hours*; sidebar with booth health, today's revenue, paper left, last session.
- **Dashboard**: locations get their own tiles (status dot + today's sessions/revenue), next to
  booths and events.
- **Reports**: per day/week/month: sessions, revenue by method (QR vs voucher), voucher use,
  uptime during opening hours, failed or cancelled payments; CSV export.
- **Alerts** (Telegram, like Gatus today) during opening hours: booth offline, printer out of
  paper or erroring, camera lost, payments failing repeatedly.
- **Remote actions**: pause/resume the location, restart the kiosk, change design or prices
  (applied to the next session), void vouchers.

## 6. Reliability for unattended booths

- Kiosk runs full-screen and locked down (browser kiosk mode), restarts by itself after a crash or
  power cut, and resumes on the attract screen.
- Opening hours turn the booth "on" and "off" (attract vs closed screen); optional screen sleep.
- Print counter and paper-low warnings (from the printer agent where the printer reports it, or a
  configured sheets-per-roll count).
- A paid session that fails (camera error, crash) is **marked for refund** automatically and shows
  the guest a code to show the cashier.

## 7. Data model (draft)

- `Event.kind`: `MANAGED | SELF_SERVICE` (default `MANAGED`; existing events unchanged).
- `Event.hours`: weekly opening hours + time zone (self-service only); `endsAt` optional for them.
- `Package`: eventId, name, price (centavos), currency, prints, layout, digital, active, order.
- `Payment`: sessionId, packageId, method (`QR | VOUCHER | FREE`), amount, provider, providerRef,
  status (`PENDING | PAID | EXPIRED | FAILED | REFUNDED`), timestamps.
- `VoucherBatch`: eventId (or null = any location), packageId, count, expiresAt, createdBy, voided.
- `Voucher`: batchId, codeHash, usedAt, sessionId.
- `Session` gains `paymentId`; a self-service session can't start shooting until it's paid.

## 8. Security notes

- Prices, packages and "paid" status live only on the server; the kiosk can't set an amount.
- Payment webhooks: signature check, idempotency key, amount and currency re-checked.
- Voucher codes: hashed, one-time, expiry, per-IP and per-booth guess limits, audit log of every
  redemption.
- Provider API keys only in the server's `.env`, never on the booth.
- New role options: **Cashier** (generate/print vouchers, see today's sales, nothing else);
  **Location manager** (one location's reports and pause/resume).

## 9. Build order (proposal)

1. **Locations + vouchers** (no online payments yet): event kind, opening hours, packages, the new
   kiosk flow with voucher entry, voucher batches and printing, closed screen, basic daily report.
   Lets you run a café booth with cashier-sold vouchers.
2. **QR payments**: provider integration, webhook, QR screen, refunds recorded, revenue report.
3. **Unattended reliability + alerts**: kiosk lockdown/auto-restart guide, paper tracking,
   Telegram alerts during opening hours, auto-refund flagging.
4. **Reports and roles**: weekly/monthly reports, CSV, Cashier and Location manager roles,
   dashboard location tiles.

## 10. Decisions needed from you

1. **Payment provider** for QR: PayMongo, Xendit, Maya Business, or another you already use?
2. **Currency and prices**: PHP? What packages (e.g. 1 strip ₱150, 2 prints ₱250, digital only ₱99)?
3. **Receipts**: do guests need a receipt (BIR / official receipt), or is the provider's
   confirmation enough? Should the café print a receipt for voucher sales?
4. **Vouchers**: tied to one café, or valid at any of your locations? Default expiry?
5. **Revenue sharing** with the café (e.g. a % per session)? If so, reports should show it.
6. **Free sessions**: allowed (promos, staff tests) and who can trigger them?
7. **Cashier role**: should café staff log in to pbooth to generate vouchers, or will you hand
   them printed batches?
8. **Opening hours**: follow the café's hours, or always on?
9. **Digital copies**: always included via the QR gallery, or a paid add-on?

## 11. Phase 10: unattended reliability (built 2026-11-25; the plan below, with these decisions)

- References look like `7K3M-Q9TX` (8 characters, so the booth's code keyboard fits them).
- Only the owner refunds money; cashiers can give a replacement voucher (₱0 in reports) for their own events.
- No guest contact details are collected. A PayMongo QR Ph refund is claimed through a link (3 days) that staff show as a QR.
- Telegram: self-service events only. System-wide alerts are for phase 11. The token is `TELEGRAM_BOT_TOKEN` in the server's `.env`.
- One staff PIN per booth, checked by the server (so it needs internet).
- Lockdown is a checklist per system; its commands haven't been run on every system version.

Decided 2026-11-24: no thermal printing. Remote desktop/RMM can be installed on booth computers
for hands-on fixes; pbooth covers alerts, guest problem reports, lockdown and reports.

### 11a. Payment references

Every self-service payment gets a short, human reference the guest can read out or photograph,
e.g. **`R-7K3M-Q9`** (unambiguous letters and digits, like booth codes).

- New `Payment.reference` (unique). Made when the payment is created (QR, voucher, free).
- Shown to the guest: on the "Get ready" screen right after paying and on the thank-you screen
  ("Your reference: R-7K3M-Q9"), and on their QR gallery page.
- Searchable in the admin (event's Sales/Transactions) and included in alerts and the CSV.
- PayMongo's own payment id is kept too (`providerRef`), so a GCash/Maya receipt can be matched.

### 11b. "Need help or a refund?" at the booth

A small, always-visible link on the **standby (welcome) screen of self-service events only**
(managed events never show it).

1. Guest taps it → picks what happened: *Paid but no session started*, *Photos didn't print*,
   *Something else*.
2. Enters their **reference** (or picks from this booth's paid payments in the last 30 minutes,
   shown by time and amount only, no names) and an optional note / mobile number.
3. pbooth records a **RefundRequest** (payment, booth, reason, note, contact, status `OPEN`) and
   sends an alert (11c). The screen shows: "Thanks. Staff have been notified. Your reference is
   R-7K3M-Q9." Rate-limited per booth so it can't be spammed.
4. Automatic flagging: a **paid session that never completed** (abandoned, crashed, camera
   error) creates a RefundRequest by itself (reason `SESSION_FAILED`), no tap needed.

Handling it (owner, and cashiers for their own events), in a new **Refunds** list:
- **QR payment** → *Refund* sends a refund through PayMongo's refunds API (full amount), then
  marks the payment `REFUNDED`. Or *Reject* with a reason.
- **Voucher payment** → *Issue a new voucher* (one-time, same event) or mark refunded in cash.
- **Give another session** → issues a complimentary one-time voucher shown on screen / sent.
- Every action is audited; reports subtract refunds.

### 11c. Alerts (Telegram)

- Settings → **Alerts** tab (owner): bot token (from @BotFather) kept in the server `.env`
  (`TELEGRAM_BOT_TOKEN`), and one or more chat ids (you, a group with the café staff). A
  **Send test** button. Per-chat choice of which alerts it gets.
- Alerts (self-service live events; managed events optional):
  - **Booth offline** for more than N minutes (default 3), and **back online**. Uses the existing
    15-second heartbeat sweep, so no new polling.
  - **Kiosk problem**: camera lost/permission denied, agent disconnected, printer error or
    out of paper (what the agent reports).
  - **Refund request** (11b), with reference, amount, method, booth, reason and a link.
  - **Payments failing**: several QR payments expired/failed in a row (possible outage).
- No spam: one alert per problem until it clears ("still offline" reminders at most hourly),
  quiet hours optional, and all alerts also listed in the admin.
- Booths are booted/shut down by your RMM schedule, so an alert during the scheduled off hours
  is suppressed by a per-event "expected hours" setting (simple daily window), not opening hours.

### 11d. Lockdown protocol (booth computers)

A written protocol in the booth page (tabbed per OS, like the agent install) plus small kiosk
features:

- **Per OS**: a dedicated local user that logs in automatically; Chrome in kiosk mode on login
  (`--kiosk --noerrdialogs --disable-session-crashed-bubble`, the booth's kiosk URL); sleep and
  screen saver off; OS updates scheduled outside hours; notifications off.
  - Windows: Assigned Access / Shell Launcher (or a startup task), disable Edge swipe gestures.
  - macOS: auto-login, Chrome as a login item, Guided Access-like restrictions via a managed
    profile where possible, energy settings.
  - Ubuntu: auto-login, `cage` or a GNOME kiosk session running Chrome.
  - iPad: Guided Access (Settings → Accessibility), auto-lock never.
- **Kiosk features**: a staff exit (long-press a corner + staff PIN, set per event) instead of
  reaching the browser; auto-reload if the page errors or loses the server for long; block
  right-click, text selection, pinch zoom and back-swipe; cursor hidden when idle.
- A one-command **lockdown setup** script per OS can follow later (like the agent installer);
  the first version is the checklist, tested on Windows and macOS.
- Remote desktop (your RMM) stays the escape hatch.

### 11e. Transaction reports and CSV

A **Transactions** page per self-service event (and an all-locations view for the owner):
- Filters: date range (venue time zone), booth, method (QR / voucher / free), status
  (paid, refunded, failed, expired), search by reference or voucher hint.
- Totals for the range: sessions, revenue, refunds, net, partner share.
- **Export CSV** of exactly what's filtered: date/time (venue time), reference, booth, method,
  status, amount, currency, voucher hint, PayMongo id, session id, refund status and amount,
  partner share. Cashiers export only their own events.
- Daily summary rows option (one line per day) for the café's accounting.

### 11f. Build order

1. Payment references (small, everything else uses them).
2. Telegram alerts: settings, offline/online, kiosk problems.
3. Refund requests: booth screen, auto-flagging, Refunds list, PayMongo refunds.
4. Transactions page and CSV export.
5. Lockdown protocol (checklist + kiosk staff exit and hardening), then optional setup scripts.

## 12. What's next

Phases 11 to 13 are planned in [ROADMAP.md](ROADMAP.md); none of it is built.
