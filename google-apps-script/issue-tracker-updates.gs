const SPREADSHEET_ID = "1lCFXw1kRPyBNs2zUc9LMA063v1AHAbehxRMezyLW1FU";
const SHEET_NAMES = ["2026", "2025"];
const EDIT_ROLES = ["Admin", "Editor"];
const USERS_PROPERTY = "JULIA_ISSUE_USERS_JSON";
const SESSION_PREFIX = "julia_issue_session_";
const SESSION_TTL_SECONDS = 21600;
const LAST_MODIFIED_AT_HEADER = "Last Modified At";
const LAST_MODIFIED_BY_HEADER = "Last Modified By";
const EDIT_LOG_HEADER = "Edit Log";
const ISSUE_PROGRESS_OPTIONS = [
  "New",
  "Initial reply sent",
  "Waiting for user",
  "Discussion ongoing",
  "Forwarded",
  "Engineer checking",
  "Closed",
  "Archived",
];
const EDITABLE_HEADERS = [
  "Date",
  "Source",
  "Email",
  "User ID",
  "Model",
  "Country",
  "Module",
  "Key Issue",
  "Detail",
  "Chinese",
  "Issue Type",
  "Severity",
  "User Emotion",
  "Needs Reply",
  "Suggested Reply",
  "Info Needed",
  "Internal Recommendation",
  "Response Date",
  "Issue Progress",
  "Handler",
  "Communication Progress",
  "More Info",
  "Issue Number",
  "Tags",
];

function doGet(e) {
  const callback = e.parameter.callback || "callback";

  try {
    if (e.parameter.action === "login") {
      return jsonp(callback, login(e.parameter.username, e.parameter.passwordHash));
    }

    if (e.parameter.action === "session") {
      return jsonp(callback, sessionInfo(e.parameter.authToken));
    }

    if (e.parameter.action === "logout") {
      logout(e.parameter.authToken);
      return jsonp(callback, { ok: true });
    }

    if (e.parameter.action === "sheetRows") {
      return jsonp(callback, sheetRows(e.parameter.sheetName));
    }

    if (e.parameter.action === "updateIssueFields") {
      const match = JSON.parse(e.parameter.match || "{}");
      const changes = JSON.parse(e.parameter.changes || "{}");
      return jsonp(callback, updateIssueFields(match, changes, e.parameter.authToken));
    }

    if (e.parameter.action === "createIssue") {
      const values = JSON.parse(e.parameter.values || "{}");
      return jsonp(callback, createIssue(e.parameter.sheetName, values, e.parameter.authToken));
    }

    return jsonp(callback, { ok: false, message: "Unknown action." });
  } catch (error) {
    return jsonp(callback, { ok: false, message: error.message || "Unknown error." });
  }
}

function doPost(e) {
  try {
    if (e.parameter.action === "updateIssueFields") {
      const match = JSON.parse(e.parameter.match || "{}");
      const changes = JSON.parse(e.parameter.changes || "{}");
      return jsonResponse(updateIssueFields(match, changes, e.parameter.authToken));
    }

    if (e.parameter.action === "createIssue") {
      const values = JSON.parse(e.parameter.values || "{}");
      return jsonResponse(createIssue(e.parameter.sheetName, values, e.parameter.authToken));
    }

    return jsonResponse({ ok: false, message: "Unknown action." });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || "Unknown error." });
  }
}

function sheetRows(sheetName) {
  const cleanSheetName = String(sheetName || "").trim();
  if (!SHEET_NAMES.includes(cleanSheetName)) {
    throw new Error("Invalid sheet name.");
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(cleanSheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${cleanSheetName}`);
  }

  return {
    ok: true,
    sheetName: cleanSheetName,
    rows: sheet.getDataRange().getDisplayValues(),
  };
}

function updateIssueFields(match, changes, authToken) {
  const session = requireEditor(authToken);
  const sheetName = String(match.year || "").trim();
  const rowNumber = Number(match.rowNumber);
  if (!SHEET_NAMES.includes(sheetName) || !Number.isInteger(rowNumber) || rowNumber < 3) {
    throw new Error("Invalid issue row identity.");
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) {
    throw new Error("Sheet is empty.");
  }

  const headers = ensureAuditHeaders(sheet, values[0].map((value) => String(value || "").trim()));
  const headerMap = createHeaderMap(headers);
  const normalizedChanges = normalizeChanges(changes);
  if (!Object.keys(normalizedChanges).length) {
    throw new Error("No valid changes to save.");
  }
  if (Object.prototype.hasOwnProperty.call(normalizedChanges, "Issue Progress")) {
    syncIssueProgressValidation(sheet, headers);
  }

  const rowValues = sheet.getRange(rowNumber, 1, 1, headers.length).getDisplayValues()[0];
  const summaries = [];
  Object.entries(normalizedChanges).forEach(([header, value]) => {
    const columnIndex = headerMap[header];
    if (columnIndex === undefined) return;
    const oldValue = String(rowValues[columnIndex] || "").trim();
    if (normalize(oldValue) === normalize(value)) return;
    sheet.getRange(rowNumber, columnIndex + 1).setValue(value).setWrap(true).setVerticalAlignment("top");
    summaries.push(formatEditSummary(header));
  });

  if (!summaries.length) {
    throw new Error("No changes to save.");
  }

  const modifiedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const modifiedBy = `${session.username} (${session.role})`;
  sheet.getRange(rowNumber, headerMap[LAST_MODIFIED_AT_HEADER] + 1).setValue(modifiedAt);
  sheet.getRange(rowNumber, headerMap[LAST_MODIFIED_BY_HEADER] + 1).setValue(modifiedBy);

  const oldLog = summarizeExistingEditLog(String(rowValues[headerMap[EDIT_LOG_HEADER]] || "").trim());
  const nextLog = `${modifiedAt} · ${modifiedBy}: Updated ${summaries.join(", ")}`;
  const editLog = oldLog ? `${nextLog}\n${oldLog}` : nextLog;
  sheet.getRange(rowNumber, headerMap[EDIT_LOG_HEADER] + 1).setValue(editLog).setWrap(true).setVerticalAlignment("top");

  return {
    ok: true,
    row: rowNumber,
    changes: normalizedChanges,
    lastModifiedAt: modifiedAt,
    lastModifiedBy: modifiedBy,
    editLog,
  };
}

function createIssue(sheetName, values, authToken) {
  const session = requireEditor(authToken);
  const cleanSheetName = String(sheetName || SHEET_NAMES[0]).trim();
  if (!SHEET_NAMES.includes(cleanSheetName)) {
    throw new Error("Invalid target sheet.");
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(cleanSheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${cleanSheetName}`);
  }

  const existingValues = sheet.getDataRange().getDisplayValues();
  if (!existingValues.length) {
    throw new Error("Sheet is empty.");
  }

  const headers = ensureAuditHeaders(sheet, existingValues[0].map((value) => String(value || "").trim()));
  const headerMap = createHeaderMap(headers);
  const normalizedValues = normalizeChanges(values);
  if (!normalizedValues["Key Issue"] && !normalizedValues.Detail) {
    throw new Error("Review and analyze fields before saving.");
  }
  syncIssueProgressValidation(sheet, headers);

  const modifiedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const modifiedBy = `${session.username} (${session.role})`;
  const rowValues = headers.map((header) => {
    if (header === LAST_MODIFIED_AT_HEADER) return modifiedAt;
    if (header === LAST_MODIFIED_BY_HEADER) return modifiedBy;
    if (header === EDIT_LOG_HEADER) return `${modifiedAt} · ${modifiedBy}: Created issue`;
    return normalizedValues[header] || "";
  });

  const rowNumber = 3;
  sheet.insertRowsBefore(rowNumber, 1);
  sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]).setWrap(true).setVerticalAlignment("top");

  return {
    ok: true,
    row: rowNumber,
    sheetName: cleanSheetName,
    changes: normalizedValues,
    lastModifiedAt: modifiedAt,
    lastModifiedBy: modifiedBy,
    editLog: rowValues[headerMap[EDIT_LOG_HEADER]],
  };
}

function normalizeChanges(changes) {
  const allowed = {};
  EDITABLE_HEADERS.forEach((header) => {
    if (Object.prototype.hasOwnProperty.call(changes, header)) {
      allowed[header] = String(changes[header] || "").trim();
    }
  });
  return allowed;
}

function ensureAuditHeaders(sheet, headers) {
  const nextHeaders = headers.slice();
  [LAST_MODIFIED_AT_HEADER, LAST_MODIFIED_BY_HEADER, EDIT_LOG_HEADER].forEach((header) => {
    if (!nextHeaders.includes(header)) {
      nextHeaders.push(header);
      sheet.getRange(1, nextHeaders.length).setValue(header);
    }
  });
  return nextHeaders;
}

function createHeaderMap(headers) {
  const map = {};
  headers.forEach((header, index) => {
    if (header && map[header] === undefined) {
      map[header] = index;
    }
  });
  return map;
}

function syncIssueProgressValidation(sheet, headers) {
  const headerMap = createHeaderMap(headers);
  const columnIndex = headerMap["Issue Progress"];
  if (columnIndex === undefined) return;

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ISSUE_PROGRESS_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  const firstDataRow = 3;
  const rowCount = Math.max(sheet.getMaxRows() - firstDataRow + 1, 1);
  sheet.getRange(firstDataRow, columnIndex + 1, rowCount, 1).setDataValidation(rule);
}

function formatEditSummary(header) {
  return header;
}

function summarizeExistingEditLog(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .split(/\n+/)
    .map((line) => summarizeEditLogLine(line))
    .filter(Boolean)
    .join("\n");
}

function summarizeEditLogLine(line) {
  const text = String(line || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\s*·\s*([^:]+):\s*(.+)$/);
  if (!match) return text;

  const date = match[1];
  const time = match[2];
  const user = match[3].replace(/\s*\([^)]*\)/g, "").trim();
  const summary = match[4];
  if (/^Updated\s+/i.test(summary) || /^Created issue$/i.test(summary)) {
    return `${date} ${time} · ${user}: ${summary}`;
  }

  const fields = summary
    .split(";")
    .map((part) => String(part || "").trim().split(":")[0].trim())
    .filter(Boolean);
  const uniqueFields = fields.filter((field, index) => fields.indexOf(field) === index);
  return `${date} ${time} · ${user}: Updated ${uniqueFields.join(", ") || "issue"}`;
}

function login(username, passwordHash) {
  const cleanUsername = String(username || "").trim();
  const cleanPasswordHash = String(passwordHash || "").trim().toLowerCase();
  if (!cleanUsername || !cleanPasswordHash) {
    throw new Error("Account and password are required.");
  }

  const user = findUser(cleanUsername);
  if (!user || user.active === false) {
    throw new Error("Invalid account or password.");
  }

  const expectedHash = String(user.passwordHash || hashCredential(user.username || cleanUsername, user.password || "")).toLowerCase();
  if (!expectedHash || cleanPasswordHash !== expectedHash) {
    throw new Error("Invalid account or password.");
  }

  const session = createSession(user);
  return {
    ok: true,
    username: session.username,
    role: session.role,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

function sessionInfo(authToken) {
  const session = requireSession(authToken);
  return {
    ok: true,
    username: session.username,
    role: session.role,
    expiresAt: session.expiresAt,
    canEdit: canEdit(session),
  };
}

function logout(authToken) {
  const token = String(authToken || "").trim();
  if (token) {
    CacheService.getScriptCache().remove(SESSION_PREFIX + token);
  }
}

function dashboardUsers() {
  const raw = PropertiesService.getScriptProperties().getProperty(USERS_PROPERTY);
  if (!raw) {
    throw new Error(`Login users are not configured. Set Script Property ${USERS_PROPERTY}.`);
  }
  const users = JSON.parse(raw);
  const normalizedUsers = Array.isArray(users)
    ? users
    : Object.entries(users || {}).map(([username, user]) => ({
        username,
        ...(user || {}),
      }));
  if (!normalizedUsers.length) {
    throw new Error(`${USERS_PROPERTY} must contain at least one user.`);
  }
  return normalizedUsers;
}

function findUser(username) {
  const key = normalize(username);
  return dashboardUsers().find((user) => normalize(user.username) === key);
}

function createSession(user) {
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
  const role = String(user.role || "Viewer").trim();
  const session = {
    username: String(user.username || "").trim(),
    role,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  CacheService.getScriptCache().put(SESSION_PREFIX + token, JSON.stringify(session), SESSION_TTL_SECONDS);
  return session;
}

function requireSession(authToken) {
  const token = String(authToken || "").trim();
  if (!token) {
    throw new Error("Please sign in again.");
  }
  const raw = CacheService.getScriptCache().get(SESSION_PREFIX + token);
  if (!raw) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  return JSON.parse(raw);
}

function canEdit(session) {
  return EDIT_ROLES.includes(String(session.role || "").trim());
}

function requireEditor(authToken) {
  const session = requireSession(authToken);
  if (!canEdit(session)) {
    throw new Error("You do not have permission to edit.");
  }
  return session;
}

function hashCredential(username, password) {
  const text = `${String(username || "").trim().toLowerCase()}:${String(password || "")}`;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Array.prototype.map.call(bytes, (byte) => {
    const value = byte < 0 ? byte + 256 : byte;
    return value.toString(16).padStart(2, "0");
  }).join("");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function jsonp(callback, payload) {
  const safeCallback = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callback) ? callback : "callback";
  return ContentService.createTextOutput(`${safeCallback}(${JSON.stringify(payload)});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
