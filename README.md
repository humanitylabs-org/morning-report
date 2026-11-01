# Morning Report

A Wizard app that reads dated morning reports, newest first. New editions show as an unread badge on the app's icon until you read them. Controls (older, date, newer, PDF) sit at the bottom for thumb reach; the PDF is the printable copy.

The app only reads. It shows whatever `<name>-YYYY-MM-DD.md` files (plus optional `-YYYY-MM-DD[-mobile].pdf` files) are in `media/Reports/morning-report/`. That folder is mounted read-only. Report content, schedules and preferences belong to the agent job that writes those files, so none of them are in this repo.

- View: `/` (vanilla JS, safe DOM-built Markdown, print stylesheet). A fenced ` ```portfolio ` JSON block is drawn as a total line plus one line per position: a put-in vs worth-now bar, the amounts and the P&L; a ` ```selling ` block as one line per item for sale; a ` ```health ` block as traffic-light tiles (green good, yellow okay, red needs attention, grey no data) with one plain line, a link to the source app and a small 7-day strip of coloured squares; other fenced blocks show as preformatted text. Block schemas are documented at the top of each renderer in `web/cards.js`.
- API: `GET /api/reports`, `GET /api/reports/{date|latest}`, `GET /api/reports/{date}.pdf`, `GET /healthz`
- Inbox feed (Wizard OS inbox v1): `GET /api/inbox` lists the newest edition while it is unread; `POST /api/inbox/act` `{key, action: "done"}` marks it read. Read state (newest edition seen) is kept on the server in `DATA_DIR/seen.json`, so the badge, the inbox and every device agree.
- MCP: `POST /mcp` with read-only tools `reports_list` and `report_read`

Repackage after source edits with `python3 tools/package.py`.
