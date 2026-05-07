# Power Automate / SharePoint Flow Design

The MOR dashboard `POST`s the payload described in `SHAREPOINT_PAYLOAD.md`
to a Power Automate **HTTP request** trigger. This document describes the
receiving flow that turns each submission into:

1. An idempotent header row in **`MOR_Submissions`** (current state per
   `submission_id`).
2. An immutable audit row in **`MOR_Submissions_History`** (one per
   `submission_id + submission_sequence`).
3. Detail rows in **`MOR_Submission_Details`** (one per noted line item),
   refreshed for the current header on every submit.

## SharePoint lists

### `MOR_Submissions` (header — upserted)

| Column                   | Type      | Source                                         |
|--------------------------|-----------|------------------------------------------------|
| `Title`                  | Text      | `concat(facility, ' — ', period, ' (', cycle, ')')` |
| `submission_id`          | Text(64)  | `submission_id` *(indexed; upsert key)*        |
| `facility`               | Text      | `facility`                                     |
| `period`                 | Text      | `period`                                       |
| `cycle`                  | Choice    | `cycle`                                        |
| `submission_sequence`    | Number    | `submission_sequence` (latest)                 |
| `last_generated_at`      | DateTime  | `generated_at`                                 |
| `staffed_beds`           | Number    | `staffed_beds`                                 |
| `days_in_month`          | Number    | `days_in_month`                                |
| `mar_net_revenue`        | Currency  | `summary.net_revenue.mar_act`                  |
| `mar_total_opex`         | Currency  | `summary.total_opex.mar_act`                   |
| `mar_ebitda`             | Currency  | `summary.ebitda.mar_act`                       |
| `mar_patient_days`       | Number    | `summary.patient_days.mar_act`                 |
| `mgmt_volume`            | Note      | `management_commentary.volume`                 |
| `mgmt_revenue`           | Note      | `management_commentary.revenue`                |
| `mgmt_expense`           | Note      | `management_commentary.expense`                |
| `submitted_by`           | Text      | `audit.submitted_by`                           |
| `submitted_role`         | Text      | `audit.submitted_role`                         |
| `source_file`            | Text      | `audit.source_file`                            |
| `source_file_sha256`     | Text(64)  | `audit.source_file_sha256`                     |
| `dashboard_version`      | Text      | `audit.dashboard_version`                      |

### `MOR_Submissions_History` (audit — append-only)

Same columns as the header list plus the **full payload** as a single
note-text column for forensic recovery:

| Column                | Type     | Source                                                    |
|-----------------------|----------|-----------------------------------------------------------|
| `Title`               | Text     | `concat(submission_id, '#', submission_sequence)`         |
| `submission_id`       | Text(64) | `submission_id`                                           |
| `submission_sequence` | Number   | `submission_sequence`                                     |
| `received_at`         | DateTime | `utcNow()` (flow time, not client time)                   |
| `client_generated_at` | DateTime | `generated_at`                                            |
| `payload_json`        | Note     | `string(triggerOutputs()?['body'])`                       |

### `MOR_Submission_Details` (detail — replaced per submit)

| Column            | Type      | Source                                              |
|-------------------|-----------|-----------------------------------------------------|
| `submission_id`   | Text      | parent header `submission_id`                       |
| `category`        | Text      | `categories[].name`                                 |
| `gl`              | Text      | `categories[].details[].gl`                         |
| `desc`            | Text      | `categories[].details[].desc`                       |
| `mar_act`         | Currency  | `mar_act`                                           |
| `mar_bud`         | Currency  | `mar_bud`                                           |
| `mar_var`         | Currency  | `mar_var`                                           |
| `ytd_var`         | Currency  | `ytd_var`                                           |
| `ppd_mar`         | Number    | `ppd_mar`                                           |
| `note`            | Note      | `note`                                              |
| `note_source`     | Choice    | `note_source` (`gl` / `callout` / null)             |
| `has_note`        | Yes/No    | `has_note`                                          |
| `requires_note`   | Yes/No    | `requires_note`                                     |

A separate `MOR_Submission_Volume` list with the same upsert pattern can
mirror the volume array (label, act, bud, var, var_pct, threshold,
threshold_unit, requires_note, note) if you want it queryable.

## Flow steps

```
[ Trigger ]  When an HTTP request is received
              └ Schema: paste a v2 sample payload

[ Step 1 ]   Initialize variable secretFromEnv (string)
              └ Value: environmentVariables('mor-shared-secret')

[ Step 2 ]   Condition — auth gate
              triggerOutputs()?['headers']?['X-MOR-Secret']
                 EQUALS  variables('secretFromEnv')

   [ False ] Response → 401 with body {"error":"unauthorized"}
             Terminate

   [ True ]  ↓

[ Step 3 ]   Parse JSON  (body of trigger, schema = v2)

[ Step 4 ]   Get items — MOR_Submissions
              Filter: submission_id eq '@{body('Parse_JSON')?['submission_id']}'
              Top count: 1

[ Step 5 ]   Condition — does header exist?

   [ True ]  Update item  (the matched header)
             Map all columns from Parse JSON.

   [ False ] Create item  in MOR_Submissions
             Map all columns from Parse JSON.

[ Step 6 ]   Create item — MOR_Submissions_History
             submission_id              = body('Parse_JSON')?['submission_id']
             submission_sequence        = body('Parse_JSON')?['submission_sequence']
             received_at                = utcNow()
             client_generated_at        = body('Parse_JSON')?['generated_at']
             payload_json               = string(triggerBody())

[ Step 7 ]   Get items — MOR_Submission_Details
             Filter: submission_id eq '@{body('Parse_JSON')?['submission_id']}'
             Apply to each → Delete item     (clears the previous detail set)

[ Step 8 ]   Apply to each   item in body('Parse_JSON')?['categories']
               Apply to each   detail in items('Apply_to_each')?['details']
                 Create item — MOR_Submission_Details
                   submission_id = …submission_id
                   category      = items('Apply_to_each')?['name']
                   gl            = items('Apply_to_each_2')?['gl']
                   …             (and so on)

[ Step 9 ]   Response → 200
             Body: { "submission_id": ..., "submission_sequence": ... }
```

### Why `Get items + Update/Create` instead of `Send HTTP request to SharePoint`?

The Send-HTTP path lets you do a true upsert via `Etag: *` and `If-Match`
on a list item URL keyed by `submission_id`, but it requires you to fetch
the item GUID first anyway. The two-step *Get → branch* pattern above is
easier to maintain in the designer and keeps run history readable.

### Why delete-then-recreate the detail rows?

Detail line items are derived from the source workbook — they are always
authoritative as a set. Trying to upsert each row by `submission_id + gl`
adds churn and makes "a GL was removed from the workbook" hard to reflect
in SharePoint. Deleting the previous set (still preserved row-by-row in
`MOR_Submissions_History.payload_json`) is the simplest correct semantics.

## Manual smoke-test checklist

After any change to the dashboard or the flow, run these checks against a
non-production SharePoint site.

### 1. Happy path

- [ ] Open the dashboard, load real data, pick cycle = `FCST02`.
- [ ] Click **📎 Workbook** and attach the source xlsx. Status shows
      `<filename> (<8-char-hash>…)`.
- [ ] Click **⇪ Submit to SharePoint**. Endpoint, secret, name, role
      prompts appear (first time only).
- [ ] Alert reads "Submitted to SharePoint (cycle FCST02, sequence #1)."
- [ ] In SharePoint:
  - `MOR_Submissions` has 1 row matching this `submission_id`,
    `submission_sequence = 1`.
  - `MOR_Submissions_History` has 1 row with `payload_json` populated.
  - `MOR_Submission_Details` has one row per noted GL, each with `note`
    and `requires_note` populated.

### 2. Wrong / missing secret returns 401

- [ ] Click **Reset secret** in the dashboard footer.
- [ ] Submit again, type a wrong secret at the prompt.
- [ ] Browser alert reads "Submit failed: HTTP 401 …".
- [ ] Power Automate run history shows the flow took the **False** branch
      of the auth condition and responded 401.
- [ ] **No new rows** in any of the three SharePoint lists.
- [ ] **No sequence increment** (the next happy-path submit is still
      sequence 1).

### 3. Resubmit idempotency

- [ ] Reset the secret to the correct value and submit again
      (same facility / period / cycle).
- [ ] Alert reads "sequence #2".
- [ ] In SharePoint:
  - `MOR_Submissions` still has **1 row** for this `submission_id`,
    now with `submission_sequence = 2` and refreshed values.
  - `MOR_Submissions_History` has **2 rows** (`#1` and `#2`).
  - `MOR_Submission_Details` rows reflect the latest payload (no
    duplicates from the first submit).

### 4. New cycle = new identity

- [ ] Switch the cycle dropdown to `MOR_PRELIM` and submit.
- [ ] `submission_id` differs from the FCST02 row.
- [ ] `submission_sequence = 1` for the new id; the FCST02 counter is
      untouched.

### 5. Missing workbook

- [ ] Click **Clear** next to the workbook status, submit.
- [ ] A toast appears: "Submitting without source workbook reference."
- [ ] Submit still succeeds (2xx).
- [ ] Header row's `source_file` and `source_file_sha256` are blank.
