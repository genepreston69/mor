# SharePoint Submission Payload

The MOR dashboard can POST a structured JSON payload to a SharePoint /
Power Automate endpoint, capturing the month's high-level results plus every
detail line item that requires a note (variance ≥ `$3,000`).

## How it works

1. Click **⇪ Submit to SharePoint** in the dashboard header.
2. The first time, paste your endpoint URL (e.g. a Power Automate
   *"When an HTTP request is received"* trigger URL). It is cached in
   `localStorage` under `mor_sharepoint_url`.
3. The dashboard `POST`s `Content-Type: application/json` with the payload
   below. Success shows an alert; failures log the full payload to the
   browser console.

To call the builder programmatically (e.g. from DevTools):

```js
const payload = window.buildSharePointPayload();
console.log(JSON.stringify(payload, null, 2));
```

## Payload schema

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-05-07T16:28:24.675Z",   // ISO-8601 UTC
  "facility": "Test Hospital",                   // from DATA.facility
  "period":   "March 2024",                      // from DATA.period
  "days_in_month": 31,                           // derived
  "staffed_beds": 80,                            // user input, may be null
  "note_threshold_dollars": 3000,                // current NOTE_MIN_VARIANCE

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
      "label":        "ADC",          // Admissions, Inpatient Days, LOS,
                                      // ADC, Equivalent ADC, Occupancy
      "act":          30,
      "bud":          31,
      "var":          -1,
      "var_pct":      -0.03,
      "py":           29,             // prior year, may be null
      "note_key":     "vol:ADC",
      "note":         "",             // text from Volume narrative card
      "requires_note": false          // |var| >= threshold (rarely true
                                      // for volume metrics in $ terms)
    }
  ],

  "revenue_narrative_notes": {
    "net_revenue":     "",            // 'rev:Net Revenue' note
    "ytd_performance": ""             // 'rev:YTD Performance' note
  },

  "management_commentary": {
    "volume":  "Free-text Volume commentary box",
    "revenue": "Free-text Revenue commentary box",
    "expense": "Free-text Expense commentary box"
  },

  "categories": [
    {
      "name":            "Salaries & Wages",
      "mar_act":         500000,
      "mar_bud":         480000,
      "mar_var":         -20000,
      "ytd_act":         1500000,
      "ytd_bud":         1440000,
      "ytd_var":         -60000,
      "ppd_mar":         null,
      "ppd_bud":         null,
      "category_note":   "Wages over due to OT.",     // 'cat:<Name>'
      "commentary_note": "",                          // 'exp:<Name>'
      "requires_note":   true,                        // |mar_var| >= 3000

      "details": [
        // Every GL line where |mar_var| >= note_threshold_dollars,
        // regardless of whether a note has been entered.
        {
          "gl":           "6100",
          "desc":         "Nursing wages",
          "mar_act":      300000,
          "mar_bud":      280000,
          "mar_var":      -20000,
          "ytd_act":      900000,
          "ytd_bud":      840000,
          "ytd_var":      -60000,
          "ppd_mar":      333,
          "note":         "OT spike from agency.",
          "note_source":  "gl",        // 'gl' | 'callout' | null
          "has_note":     true,
          "requires_note": true
        }
      ]
    }
  ]
}
```

### Notes on shape

- **`summary.*` entries are objects, not arrays.** Field names match the
  internal `DATA.<key>` shape so changes flow through naturally.
- **`categories[]` is filtered.** A category appears only if it has at least
  one detail meeting the threshold, or has a category-level note, or its own
  variance meets the threshold. Categories that are entirely "quiet" are
  omitted to keep the payload small.
- **`details[]` is the source of truth for the "data that requires a note."**
  Every entry here had `|mar_var| ≥ note_threshold_dollars` at submit time.
  Use `has_note` to find lines still missing commentary.
- **`note_source`** disambiguates which UI surface the note was authored on:
  `gl` (the category drill-down row) takes priority over `callout` (the
  unfavorable callouts section) since both can target the same GL.

### Note key reference

These are the localStorage keys (under `mor_notes`) that map into the
payload — useful if you ever load notes externally:

| Key pattern         | Where it appears in the UI                        | Payload location                       |
|---------------------|---------------------------------------------------|----------------------------------------|
| `vol:<Label>`       | Volume narrative cards (ADC, LOS, Occupancy, …)   | `volume[].note`                        |
| `rev:Net Revenue`   | Revenue narrative card                            | `revenue_narrative_notes.net_revenue`  |
| `rev:YTD Performance` | Revenue narrative card                          | `revenue_narrative_notes.ytd_performance` |
| `exp:<Category>`    | Expense narrative card                            | `categories[].commentary_note`         |
| `cat:<Category>`    | Expense table category row                        | `categories[].category_note`           |
| `gl:<GL>`           | Expense table drill-down row                      | `categories[].details[].note`          |
| `callout:<GL>`      | Unfavorable Callouts section                      | `categories[].details[].note` (fallback) |

Management commentary boxes (Volume / Revenue / Expense) are stored
separately under `mor_mgmt_commentary` and surface as `management_commentary`.

## Power Automate / SharePoint setup

Suggested flow (one-shot, low-code):

1. **Trigger**: *"When an HTTP request is received"* — accept the JSON above
   (you can paste a sample to auto-generate the schema).
2. **Parse JSON** action with the auto-generated schema.
3. **Header list** — *Create item* in a SharePoint list keyed by
   `facility + period`. Map `summary.*` and `management_commentary.*` to
   columns.
4. **Detail list** — *Apply to each* `categories[]` → *Apply to each*
   `details[]` → *Create item* in a child SharePoint list with columns:
   `facility`, `period`, `category`, `gl`, `desc`, `mar_act`, `mar_bud`,
   `mar_var`, `ytd_var`, `note`, `has_note`, `note_source`.
5. **Response**: HTTP 200 (the dashboard treats any non-2xx as failure and
   logs the payload to the console).

The endpoint URL is the only piece of configuration on the dashboard side —
no auth headers, tenant IDs, or list GUIDs are baked in.
