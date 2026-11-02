# Report sections (`wizard.report-section/1`)

The Morning Report is a roll-up: each section comes from the app that owns it, in one format, so any app can add a
section and the owner can move it out of the report or turn it off from inside the report. The report is a white
sheet on purpose (it is meant to be printed each morning), so a section is short: a heading, a few lines, a link.

## What an app serves

`GET /<app>/api/report?date=YYYY-MM-DD&tz=Area/City` (also accepted without the `/<app>` prefix), box-only, read-only:

```json
{
  "report": 1,
  "app": "wizard-health",
  "date": "2026-11-03",
  "sections": [
    {
      "id": "wizard-health",
      "title": "Health",
      "lines": ["- one Markdown line with a [label](https://example.com) link", "_an italic note_"],
      "card": {"kind": "health", "...": "..."},
      "link": "/wizard-health/",
      "final": false,
      "wait": true,
      "updated": 1793600000,
      "order": 20
    }
  ]
}
```

| field | meaning |
|---|---|
| `report` | always `1` for this version; anything else is ignored |
| `id` | `<app id>` or `<app id>.<name>` (`[a-z0-9-]`); an app may only send its own ids. The owner's route for it is `report:<id>` |
| `title` | the `## ` heading, at most 40 characters |
| `lines` | up to ~5 Markdown lines (`- ` bullets, `_italic_` notes, `**bold**`, `[label](url)` links). Hard cap 8 lines of 600 characters; headings, fences, comments and rules are dropped |
| `card` | optional fenced card the report knows how to draw (`health`, `portfolio`, `selling`; schemas at the top of each renderer in `web/cards.js`), drawn above the lines |
| `link` | the app, a same-origin path (`/<app>/`) or https URL; the heading links to it |
| `final` | `false` while the content may still change today (e.g. last night's sleep is still being scored). Default `true` |
| `wait` | `true` if the report's final version should wait for this section to be final (Health). Default `false` |
| `updated` | epoch seconds when the app computed it |
| `order` | sort key, lower first (Today 10, Health 20) |

A quiet day is `"sections": []`: the section is simply not in the report. An app that is not connected to anything
answers `[]` too. Errors are the app's own HTTP errors; the report then falls back (below).

## What the report does with it (generator side)

The owner's report generator (on Miguel's box `~/.hermes/scripts/morning_report_sections.py`, used by
`oscar_morning_briefing_v2.py`):

1. Finds running apps in the box's app registry (`~/.wizard-os/apps.json`, read only) and asks each one for
   `api/report` with the report day and the owner's time zone, in parallel with a short timeout.
2. Apps whose repo is not ours get a narrow read-only adapter until they serve the format themselves (Calendar:
   `GET /api/events`, the owner's visible calendars from 05:00 to 05:00, cancelled and declined events left out).
3. Applies the owner's routes from Notifications `GET /notifications/api/routes`: `report:<id>` is `daily`
   (Morning report, the default) or `off`. An Off section is left out and noted at the end as
   `<!-- mr:off {...} -->`, so the app can list it under **Turned off** with its picker. Chats and Badge are refused for
   report sections until an app can deliver its section by itself.
4. Draws each section as:

   ~~~
   ## Health
   <!-- mr:section {"id":"wizard-health","app":"wizard-health","route":"report:wizard-health","link":"/wizard-health/","final":true,"wait":true,"updated":1793600000} -->

   ```health
   {...card...}
   ```
   - lines
   ~~~

   The comment is invisible in any Markdown viewer and skipped by the PDF; this app reads it to put the
   Chats · Badge · Morning report · Off picker under the heading, link the heading to the app and say "so far" while
   `final` is false.
5. Keeps the old code for Today and Health as the fallback, so a section never goes missing when an app is down.

The edition itself carries `<!-- mr:edition {"format":"wizard.report-section/1","date":...,"stage":"draft"|"final",...} -->`
under the `_Generated 06:02 Bangkok · draft_` line.

## Draft and final

- **Draft**: the 06:00 run writes the edition with every section's `final` flag.
- **Final**: a finalize step re-asks every app section. Once every section with `wait: true` is final (the wake
  signal: Health's night is scored and ended at least 1.5 h ago), or at a fixed fallback time (09:00) if that never
  happens, it rewrites the changed sections, marks the edition final (`_Generated 06:02 Bangkok · final 07:52_`),
  re-renders the PDF and prints it if printing is turned on. At most once a day. Sections still not final after that
  keep being redrawn until noon, without a reprint.

## Adding a section to an app

1. Add `GET /api/report` returning the shape above (one section is typical). Keep it read-only and fast.
2. Say `final: false` only while the content can still change today; set `wait: true` only if the morning paper
   would be wrong without it.
3. Test it: a quiet day returns `[]`, ids stay inside the app's namespace, at most ~5 lines.

Live examples: Health (`oscarhenrycollins/wizard-health`, `report_section()` in `app/server.py`) and the Calendar
adapter (`calendar_today()` in the generator's `morning_report_sections.py`).
