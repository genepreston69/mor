# SharePoint Submission Payload (schema v2)

The MOR dashboard `POST`s a structured JSON payload to a Power Automate
endpoint, capturing the month's high-level results plus every detail line
item that requires a note. Schema v2 adds cycle/sequence/audit metadata for
idempotent upserts and a shared-secret header for auth.

## How it works

1. Pick the **submission cycle** in the dropdown next to the Submit button:
   `FCST01`, `FCST02`, `MOR Preliminary`, or `MOR Final`. Selection is
   remembered between sessions in `localStorage` (`mor_cycle`).
2. Optionally click **📎 Workbook** and select the source spreadsheet for
   this submission. The browser computes its SHA-256 in-session; the file
   name is remembered (the hash is not — re-pick the file each session if
   you want it included). If you submit without a workbook attached, a
   non-blocking warning toast appears.
3. Click **⇪ Submit to SharePoint**.
4. On the first submit, three one-time prompts appear (URL, shared secret,
   submitter name + role). All four values are cached in `localStorage` and
   never asked again unless reset.
5. The dashboard `POST`s `Content-Type: application/json` plus an
   `X-MOR-Secret` header. On 2xx, the per-`(facility, period, cycle)`
   sequence counter is incremented. On non-2xx, the counter is left alone
   and the full payload is logged to the browser console.

To call the builder programmatically (e.g. from DevTools):

```js
const payload = await window.buildSharePointPayload();
console.log(JSON.stringify(payload, null, 2));
```

> **Breaking change vs. v1:** the builder is now `async` (it uses the Web
> Crypto API to hash the `submission_id`). Callers must `await` it.

## v2 example payload

```jsonc
{
  "schema_version":       2,
  "submission_id":        "f3b2…64-char-hex…",   // sha256(facility|period|cycle)
  "submission_sequence":  3,                      // monotonic per submission_id
  "cycle":                "FCST02",               // FCST01|FCST02|MOR_PRELIM|MOR_FINAL
  "generated_at":         "2026-05-07T16:28:24.675Z",
  "facility":             "Acme Hospital",
  "period":               "April 2026",
  "days_in_month":        30,
  "staffed_beds":         80,
  "note_threshold_dollars": 3000,                 // applies to summary/categories

  "labor": {
    "direct_care_fte_actual": 42.5,
    "direct_care_fte_budget": 40.0,
    "total_fte_actual":       110.0,
    "total_fte_budget":       105.0
  },

  "summary": {
    // Each entry: { mar_act, mar_bud, mar_var, ytd_act, ytd_bud, ytd_var,
    //               ppd_mar, ppd_bud }   (any field may be null)
    "net_revenue":    { ... },
    "total_opex":     { ... },
    "ebitda":         { ... },
    "ip_gross":       { ... },
    "ip_contractual": { ... },
    "supplemental":   { ... },
    "patient_days":   { ... }
  },

  "volume": [
    {
      "label":         "ADC",
      "act":           27,
      "bud":           30,
      "var":           -3,
      "var_pct":       -0.10,
      "py":            null,
      "note_key":      "vol:ADC",
      "note":          "Census softness in the back half of the month.",
      "threshold":     2,
      "threshold_unit":"count",        // 'count' or 'pct'
      "requires_note": true            // |fieldVal| >= threshold
    }
    // ... one entry per: Admissions, Inpatient Days, LOS, ADC,
    //                    Equivalent ADC, Occupancy
  ],

  "revenue_narrative_notes": {
    "net_revenue":     "",
    "ytd_performance": ""
  },

  "management_commentary": {
    "volume":  "...",
    "revenue": "...",
    "expense": "..."
  },

  "categories": [
    {
      "name":            "Salaries & Wages",
      "mar_act":         500000, "mar_bud": 480000, "mar_var": -20000,
      "ytd_act":         1500000,"ytd_bud": 1440000,"ytd_var": -60000,
      "ppd_mar":         null,   "ppd_bud": null,
      "category_note":   "Wages over due to OT.",
      "commentary_note": "",
      "requires_note":   true,
      "details": [
        {
          "gl":           "6100",
          "desc":         "Nursing wages",
          "mar_act":      300000, "mar_bud": 280000, "mar_var": -20000,
          "ytd_act":      900000, "ytd_bud":  840000,"ytd_var": -60000,
          "ppd_mar":      333,
          "note":         "OT spike from agency coverage.",
          "note_source":  "gl",            // 'gl' | 'callout' | null
          "has_note":     true,
          "requires_note": true
        }
      ]
    }
  ],

  "audit": {
    "submitted_by":        "Gene Preston",
    "submitted_role":      "Facility CFO",
    "source_file":         "FCST02_April2026.xlsx",      // null if unattached
    "source_file_sha256":  "a3f2c891…64-char-hex…",      // null if unattached
    "user_agent":          "Mozilla/5.0 …",
    "dashboard_version":   "v2.0.0"
  }
}
```

### Volume thresholds

`note_threshold_dollars` (3,000) governs the `summary` and `categories`
sections. Volume metrics use **per-metric, per-unit** thresholds because the
dollar threshold doesn't make sense for census/length-of-stay numbers:

| Metric           | Threshold | Unit    | Driving field |
|------------------|-----------|---------|---------------|
| ADC              | 2         | `count` | `var`         |
| Inpatient Days   | 60        | `count` | `var`         |
| LOS              | 0.05      | `pct`   | `var_pct`     |
| Occupancy        | 0.03      | `pct`   | `var_pct`     |
| Admissions       | 10        | `count` | `var`         |
| Equivalent ADC   | 2         | `count` | `var`         |

Each volume entry includes both `threshold` and `threshold_unit` so the
receiver doesn't have to keep this table in sync.

### Notes on shape

- **`submission_id` is the upsert key.** It is `sha256(facility + '|' + period + '|' + cycle)`
  in lowercase hex. Two submits for the same cycle produce the same id;
  changing facility, period, or cycle produces a different one.
- **`submission_sequence` is the audit counter.** It increments by 1 only
  when a submit returns 2xx, and is scoped to `(facility, period, cycle)`.
  Treat it as the audit-trail row key; use `submission_id` as the header
  upsert key.
- **`categories[]` is filtered.** A category appears only if it has at
  least one detail meeting the threshold, has a category- or commentary-
  level note, or its own variance meets the threshold. Quiet categories
  are omitted.
- **`details[]` is the source of truth for "data that requires a note."**
  Every entry had `|mar_var| ≥ note_threshold_dollars` at submit time. Use
  `has_note` to find lines still missing commentary.
- **`note_source`** disambiguates which UI surface the note was authored
  on: `gl` (drill-down) takes priority over `callout` (unfavorable
  callouts) since both can target the same GL.

### Note key reference

These are the localStorage keys (under `mor_notes`) that map into the
payload:

| Key pattern           | UI location                                    | Payload location                          |
|-----------------------|------------------------------------------------|-------------------------------------------|
| `vol:<Label>`         | Volume narrative cards                         | `volume[].note`                           |
| `rev:Net Revenue`     | Revenue narrative card                         | `revenue_narrative_notes.net_revenue`     |
| `rev:YTD Performance` | Revenue narrative card                         | `revenue_narrative_notes.ytd_performance` |
| `exp:<Category>`      | Expense narrative card                         | `categories[].commentary_note`            |
| `cat:<Category>`      | Expense table category row                     | `categories[].category_note`              |
| `gl:<GL>`             | Expense table drill-down row                   | `categories[].details[].note`             |
| `callout:<GL>`        | Unfavorable Callouts section                   | `categories[].details[].note` (fallback)  |

Management commentary boxes (Volume / Revenue / Expense) live under
`mor_mgmt_commentary` and surface as `management_commentary`.

### localStorage keys used by submission

| Key                                          | Set by                | Purpose                                           |
|----------------------------------------------|-----------------------|---------------------------------------------------|
| `mor_sharepoint_url`                         | First submit          | Endpoint URL                                      |
| `mor_sharepoint_secret`                      | First submit          | Shared secret sent as `X-MOR-Secret`              |
| `mor_submitted_by`                           | First submit          | `audit.submitted_by`                              |
| `mor_submitted_role`                         | First submit          | `audit.submitted_role`                            |
| `mor_cycle`                                  | Cycle dropdown        | Last-selected cycle                               |
| `mor_seq:{facility}:{period}:{cycle}`        | After 2xx submit only | Monotonic submission sequence counter             |
| `mor_last_source_file`                       | 📎 Workbook picker    | Last attached file name (hash never persisted)    |

The footer of the page exposes **Reset endpoint**, **Reset secret**, and
**Reset submitter info** links, which clear those keys and re-prompt on the
next submit.

## v1 → v2 migration

| Concern                      | v1                                       | v2                                                                      |
|------------------------------|------------------------------------------|-------------------------------------------------------------------------|
| `schema_version`             | `1`                                      | `2`                                                                     |
| Builder API                  | Sync — returns object                    | **Async** — returns `Promise<object>` (uses Web Crypto)                 |
| Submission identity          | None                                     | `submission_id` (sha256), `submission_sequence`, `cycle`                |
| Cycle (forecast / MOR stage) | Implicit (whatever was last edited)      | Explicit enum: `FCST01 \| FCST02 \| MOR_PRELIM \| MOR_FINAL`            |
| Auth                         | URL secrecy only                         | `X-MOR-Secret` header (cached client-side, validated by Power Automate) |
| Volume `requires_note`       | `\|var\| ≥ $3,000` (dollar test on every metric — bug for ADC/LOS/Occupancy) | Per-metric thresholds with explicit `threshold` + `threshold_unit` fields |
| Audit metadata               | None                                     | `audit` block: submitter name/role, source file + SHA-256, user agent, dashboard version |

### Receiver checklist

If the SharePoint side previously consumed v1, you'll want to:

1. Bump the **Parse JSON** schema in Power Automate to the v2 shape (paste
   a fresh sample to regenerate).
2. Add a **Condition** step at the top of the flow comparing
   `triggerOutputs()?['headers']?['X-MOR-Secret']` to your environment-
   variable secret. Return HTTP 401 on mismatch.
3. Switch from "Create item" to **upsert by `submission_id`** for the
   header list (look up first, update if found, create if not). See
   `POWER_AUTOMATE_FLOW.md`.
4. Add a `MOR_Submissions_History` list keyed by
   `submission_id + submission_sequence` for the full audit trail.
5. Map the new `audit.*` fields and the new volume fields (`threshold`,
   `threshold_unit`).

## Tests

Run the vanilla-Node test suite:

```bash
node tests/payload.test.js
```

It covers schema shape across all four cycles, deterministic
`submission_id` + monotonic `submission_sequence`, and the per-metric
volume threshold logic (including the ADC `var=-3` regression of the v1
bug).
