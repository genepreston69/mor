# MOR Deep Dive — Instruction Manual

This manual walks a facility finance user through running the **Monthly
Operating Review (MOR) Deep Dive** dashboard end-to-end: loading the
month's data, reviewing variances, capturing commentary, and submitting
the finished package to SharePoint.

If you maintain the Power Automate flow or the receiving SharePoint
lists, see `POWER_AUTOMATE_FLOW.md` and `SHAREPOINT_PAYLOAD.md` instead —
those describe the wire format and the receiver side.

---

## 1. What this app is

`index.html` is a single-file dashboard that runs entirely in your
browser. It does **not** upload your Excel files anywhere — parsing
happens locally and uploaded data is kept in your browser's local
storage. The only network call the dashboard makes is the final
**Submit to SharePoint** action, which sends a structured JSON
summary (not the spreadsheet itself) to your Power Automate endpoint.

The companion file `Forecast_Narrative_Builder.html` is a smaller tool
for drafting forecast narratives from the same source workbooks; it is
covered briefly in §8.

### What you need before you start

- A modern browser (Chrome, Edge, or Firefox — current version).
- The month's **Month End Analytic** export (`.xlsx`).
- The month's **MOR Standard Deck** (`.xlsx`) — the dashboard reads the
  `MOR_MTD` tab.
- The shared secret and Power Automate endpoint URL for SharePoint
  submission (from IT — only needed the first time you submit on a new
  device/browser).
- Your name and role as you want them recorded on the submission
  (e.g. "Gene Preston", "Facility CFO").

---

## 2. Opening the dashboard

Open `index.html` by double-clicking it, or by serving it from any
static host. No build step, no install, no login.

On first load you'll see:

- A teal **MOR DEEP DIVE** banner at the top.
- A facility brand block on the left (it will read "Hospital / MOR
  Dashboard" until data is loaded).
- A header toolbar on the right with: **Thresholds**, the **cycle**
  dropdown, **📎 Workbook**, **⇪ Submit to SharePoint**, and **Print**.
- A **Data Source · Upload Monthly Files** panel.
- An empty-state message: *"No Data Loaded — Upload your source files
  to populate the dashboard."*

---

## 3. Loading the month's data

In the **Data Source** panel:

1. Click the **Month End Analytic (.xlsx)** slot and pick the analytic
   export. The slot will show the file name and a green check when it
   parses successfully.
2. Click the **MOR Standard Deck (.xlsx)** slot and pick the deck. The
   dashboard reads the `MOR_MTD` tab.
3. Enter **Staffed Beds** for the facility (used to compute occupancy
   and per-patient-day metrics). The value is remembered between
   sessions.
4. The status line at the bottom of the panel will say
   *"Loaded data persists in your browser until you upload new files or
   reset."* Click **Hide** to collapse the panel.

### Resetting or replacing data

- Re-uploading either file replaces only that side of the data.
- **Clear Data** wipes the cached parse of both files (but keeps your
  notes, commentary, thresholds, and SharePoint settings).
- Notes and management commentary live under separate keys — see §10
  if you need to clear them.

### If a file won't load

- Confirm the file is `.xlsx` (not `.xls` or a CSV exported with the
  wrong template).
- The deck **must** contain a sheet named `MOR_MTD`. Tabs that have
  been renamed (e.g. "MOR MTD" with a space) will not parse.
- If the analytic was emailed as a `.zip` or saved from SharePoint with
  a `(1)` suffix appended, that's fine — only the extension matters.

---

## 4. Reading the dashboard

Once both files are loaded the dashboard populates top to bottom.
Every section can be reviewed in place; no navigation between pages.

### View toggle: `$ Dollars` vs `Per Patient Day`

The tab bar above the KPIs lets you flip the whole dashboard between
**Dollar** mode and **PPD** mode. PPD divides every dollar figure by
patient days for the period and surfaces unit-economics outliers that
dollar variances can hide.

### Sections in order

| Section | What it shows |
|---|---|
| **KPI grid** | Net revenue, total opex, EBITDA, patient days, etc. with MAR actual vs budget and a status pill. |
| **Volume, Payor Mix & Service Mix** | Three mini-tables sourced from the standard deck. |
| **Volume Commentary** | Auto-generated narrative on census/LOS/payor mix, plus a **Management Commentary** textarea for your overlay. |
| **Top Opportunities** | The largest absolute variances vs. budget — your headline call-outs. |
| **Revenue Waterfall** | IP gross to net revenue with deductions, charity, denials, and bad debt. |
| **Revenue Detail Drill-Down** | Click a revenue line to expand its components. |
| **Revenue Commentary** | Net revenue and YTD narrative, plus management commentary. |
| **Strategic Insights** | Cross-cutting reads the standard MOR doesn't surface. |
| **Operating Expense Drill-Down** | Categories sorted by variance magnitude; click to expand GL detail. |
| **Expense Commentary** | Variance narrative and management commentary. |
| **Labor Management** | EPOB Paid, Equivalent EPOB, Paid FTEs, Labor Cost, AHR, and the three impact rows. |
| **Trended Performance** | Trailing actuals through the current period. |

### Status pills

Each row in the KPI grid, drill-downs, and volume tables gets a colored
status pill (green / amber / red) based on materiality thresholds. The
default thresholds are described in §6.

### Variance sign convention

Variances are computed as **Budget − Actual**. For expenses this means
*favorable when actual is below budget*. The same convention is shown
in the footer of every print-out.

---

## 5. Adding notes

Two kinds of commentary are captured in the dashboard:

### Line-item notes

Any row in the expense drill-down, revenue drill-down, or callouts that
meets the materiality threshold is **required** to carry a note before
submission. Click the row to expand it, then click the **Add note** /
note icon to open the note modal. Type your note and **Save Note**.

- Notes are saved per row identifier (GL number or volume label) and
  persist across sessions.
- The note modal also has a **Delete Note** button (only visible when a
  note already exists) if you typed one in error.
- A small badge on each section header tells you how many noted rows
  vs. how many *require* a note.

### Management commentary

Three large textareas at the bottom of the **Volume**, **Revenue**, and
**Expense Commentary** sections capture your narrative summary. These
are free-form and are not driven by thresholds. They appear in the
SharePoint payload under `management_commentary.{volume,revenue,expense}`.

---

## 6. Adjusting thresholds

Click the **⚙ Thresholds** button in the header to open the thresholds
modal. Three tabs:

1. **Global defaults** — the dollar threshold that drives the
   "requires a note" rule on summary lines and expense categories
   (default: $3,000), plus the per-metric volume thresholds (ADC,
   Inpatient Days, LOS, Occupancy, Admissions, Equivalent ADC).
2. **Per-category** — override the global dollar threshold for a
   specific expense category (e.g. raise it for Salaries & Wages where
   small swings are not material).
3. **Per-GL account** — override at the individual GL line level. Use
   the search box at the top to filter.

Blank fields **inherit from the level above**. So a blank GL value
falls back to the category value; a blank category value falls back to
the global default.

**Reset to defaults** at the bottom-left of the modal restores the
ship defaults across all three tabs. **Save** applies your changes;
**Cancel** discards them.

Changes recompute the status pills and "requires note" flags
immediately. Notes you've already written are **not** discarded when
you lower a threshold — they remain attached to the row.

---

## 7. Submitting to SharePoint

Once the dashboard reads correctly and every required-note row has
commentary, you're ready to submit.

### Step-by-step

1. **Pick the submission cycle** in the dropdown next to the
   **⇪ Submit** button:
   - `FCST01` — first forecast cut
   - `FCST02` — refreshed forecast
   - `MOR Preliminary` — preliminary close
   - `MOR Final` — final, signed-off close

   The cycle is remembered between sessions. **Each cycle is a separate
   submission identity** — submitting twice on FCST02 updates the same
   record; switching to MOR Final creates a new one.

2. **(Recommended)** Click **📎 Workbook** and select the source
   spreadsheet for this submission. The browser computes a SHA-256
   hash in-session and stamps it onto the submission for forensic
   tracing. The file name is remembered between sessions; the hash is
   not — re-pick the file each session if you want the hash recorded.
   The status next to the button shows `<filename> (<8-char hash>…)`.

3. Click **⇪ Submit to SharePoint**.

4. **First-time prompts** (only on a fresh browser):
   - **Endpoint URL** — the Power Automate HTTP trigger URL from IT.
   - **Shared secret** — the value of the `X-MOR-Secret` header.
   - **Submitter name** — e.g. "Gene Preston".
   - **Submitter role** — e.g. "Facility CFO".

   All four are cached in `localStorage` and never asked again until
   you reset them.

5. On success you'll see:
   *"Submitted to SharePoint (cycle FCST02, sequence #1)."*

   The sequence counter increments by one for each successful submit on
   the same `(facility, period, cycle)` combination.

### What if the submit fails?

- **HTTP 401** — the secret is wrong. Click **Reset secret** in the
  footer of the Thresholds modal and submit again; you'll be re-prompted.
- **Other HTTP errors / network errors** — the full payload is logged
  to the browser console (open DevTools → Console). The sequence
  counter is **not** incremented on failure, so retrying will not
  burn a sequence number.
- **"Submitting without source workbook reference"** — a warning toast,
  not a blocker. The submission still goes through; `source_file` and
  `source_file_sha256` will be blank on the SharePoint row.

### What gets sent

The payload is a JSON summary of the dashboard state — every KPI,
every required-note line with its note, both narratives and management
commentary, the labor block, and an audit envelope. The Excel files
themselves are **not** uploaded. The full schema is documented in
`SHAREPOINT_PAYLOAD.md`.

### Resetting cached submission settings

Open the Thresholds modal — at the bottom you'll find three reset
links:

- **Reset endpoint** — clears the Power Automate URL.
- **Reset secret** — clears the shared secret.
- **Reset submitter info** — clears submitter name + role.

Use these when moving to a new environment (e.g. dev → prod) or when
the secret rotates. The next submit will re-prompt for any cleared
value.

---

## 8. Printing and sharing

Click **⎙ Print** in the header to render a print-friendly version of
the dashboard. All collapsed drill-down rows are expanded automatically
so nothing is hidden behind a click in the printed copy. Use your
browser's "Save as PDF" target if you need a file artifact rather than
a hard copy.

For ad-hoc sharing without SharePoint, printing to PDF and emailing
the PDF is the supported path.

---

## 9. Forecast Narrative Builder

`Forecast_Narrative_Builder.html` is a separate tool for drafting
forecast narratives from the source workbooks. Open it the same way
you open the dashboard. Drag-and-drop or click the drop zone to load
a workbook, adjust the per-line projection inputs, and the tool will
emit a narrative block you can paste into your forecast deck or email.

The builder does **not** submit to SharePoint and does not share state
with the MOR Deep Dive dashboard.

---

## 10. Tips, gotchas, and where things are stored

### One browser, one machine

All of your state — uploaded files, notes, commentary, thresholds,
SharePoint settings — lives in your browser's `localStorage` for the
origin that served `index.html`. Switching browsers or machines means
starting fresh. Notes do **not** sync across devices.

### Private / incognito windows

`localStorage` is cleared when a private window closes. Don't run the
MOR in a private window unless you intend to re-enter everything from
scratch each session.

### Re-uploading mid-review

If you re-upload either source file mid-review:

- Notes attached to GLs and volume labels that still exist are
  preserved (notes are keyed by GL number / metric label, not by row
  position).
- Notes attached to GLs that no longer appear in the new file become
  orphaned — they still occupy space in `localStorage` but won't
  surface anywhere on screen. They will **not** be included in the
  next submission.

### Cycle vs period

The **cycle** is the close stage (FCST01/02 or MOR Prelim/Final). The
**period** is the calendar month being reported (e.g. "April 2026"),
which the dashboard derives from the source workbook. Submitting two
cycles for the same period (e.g. FCST02 then MOR Preliminary for April
2026) produces two separate SharePoint records — they're tracked
independently.

### Resubmitting the same cycle

Resubmitting `(facility, period, cycle)` is fully supported and
expected — the SharePoint header row is upserted in place, and the
sequence counter increments. The full prior payload is preserved in
the audit history list. See `POWER_AUTOMATE_FLOW.md` §3 for the
expected receiver behavior.

### LocalStorage keys (for IT troubleshooting)

| Key | Purpose |
|---|---|
| `mor_notes` | All line-item notes (GL, volume, callout, narrative). |
| `mor_mgmt_commentary` | The three management commentary textareas. |
| `mor_thresholds` | Global / per-category / per-GL threshold overrides. |
| `mor_beds` | Staffed bed count. |
| `mor_cycle` | Last-selected submission cycle. |
| `mor_sharepoint_url` | Power Automate endpoint URL. |
| `mor_sharepoint_secret` | Shared secret for `X-MOR-Secret`. |
| `mor_submitted_by` / `mor_submitted_role` | Submitter identity. |
| `mor_last_source_file` | Last attached workbook file name. |
| `mor_seq:{facility}:{period}:{cycle}` | Monotonic sequence counter. |

To wipe everything and start completely fresh, run this in your
browser's DevTools console on the page:

```js
Object.keys(localStorage).filter(k => k.startsWith('mor_')).forEach(k => localStorage.removeItem(k));
location.reload();
```

---

## 11. Monthly close checklist

A suggested order of operations for a normal MOR Final close:

- [ ] Receive the Month End Analytic and MOR Standard Deck exports.
- [ ] Open `index.html` (or refresh if already open) and upload both
      files. Confirm staffed beds are correct.
- [ ] Scan the KPI grid for any red pills and skim Top Opportunities.
- [ ] Toggle to **Per Patient Day** view and recheck — small dollar
      moves often look very different on a PPD basis.
- [ ] Open the expense drill-down. Expand every red category and add
      notes on each required-note GL.
- [ ] Open the revenue drill-down and do the same.
- [ ] Read the auto-generated Volume / Revenue / Expense commentary.
      Write your management overlay in the three management commentary
      textareas.
- [ ] Set the cycle dropdown to **MOR Final**.
- [ ] Click **📎 Workbook** and attach the analytic workbook used.
- [ ] Click **⇪ Submit to SharePoint**. Confirm the success alert.
- [ ] Click **⎙ Print** → Save as PDF for the local archive.
- [ ] Verify the row landed in SharePoint (your IT contact can share
      the list link). Sequence number should be `#1` for the first
      MOR Final submit of the period.

If anything is unclear, open an issue in the repository or contact
your finance systems administrator.
