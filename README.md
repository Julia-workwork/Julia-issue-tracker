# Julia's Issue Tracker

Public GitHub Pages build for Julia's HAM user issue tracking dashboard.

Expected public URL:

`https://julia-workwork.github.io/Julia-issue-tracker/`

Current status:
- Static HTML/CSS/JavaScript web page.
- Google Sheet live read-only data is connected.
- Reads the `2026` and `2025` tabs from `HAM User Issue`.
- Detail cards are editable in the browser.
- New Issue saves are connected and insert new rows at the top of the target year sheet.
- Writing edits back to Google Sheet uses `google-apps-script/issue-tracker-updates.gs`.
- Deploy the Apps Script as a web app, then paste its `/exec` URL into `GOOGLE_APPS_SCRIPT_URL` in `app.js`.
- `preview.png` is the latest visual screenshot.

Apps Script editing setup:
1. Create a Google Apps Script project.
2. Paste `google-apps-script/issue-tracker-updates.gs`.
3. Add Script Property `JULIA_ISSUE_USERS_JSON`, for example:

```json
{
  "Julia": {
    "username": "Julia",
    "password": "your-password",
    "role": "Admin",
    "active": true
  }
}
```

4. Deploy as a web app with access set to anyone with the link.
5. Copy the web app `/exec` URL into `GOOGLE_APPS_SCRIPT_URL`.
