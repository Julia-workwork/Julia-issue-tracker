# Julia's Issue Tracker

Official static web output for the HAM user issue tracking dashboard.

Open `index.html` in a browser to view the page.

Current status:
- Static HTML/CSS/JavaScript web page.
- Google Sheet live read-only data is connected.
- Reads the `2026` and `2025` tabs from `HAM User Issue`.
- Detail cards are editable in the browser.
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
