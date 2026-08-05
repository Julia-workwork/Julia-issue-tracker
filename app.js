const SPREADSHEET_ID = "1lCFXw1kRPyBNs2zUc9LMA063v1AHAbehxRMezyLW1FU";
const SHEET_NAMES = ["2026", "2025"];
const SHEET_LOAD_TIMEOUT_MS = 20000;
const SHEET_RETRY_DELAYS_MS = [900, 2200];
const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzUJRPV65kwDEOv5awlrg3XCTett9KBXgX_bxLP0WlDWL8TFtl50I_zWEo3S0QUb3Bq/exec";
const AUTH_TOKEN_KEY = "juliaIssueAuthToken";

const STATUSES = [
  { key: "submit", label: "To Submit", className: "submit" },
  { key: "submitted", label: "Submitted", className: "submitted" },
  { key: "progress", label: "In Progress", className: "progress" },
  { key: "resolved", label: "Resolved", className: "resolved" },
  { key: "archived", label: "Archived", className: "archived" },
];

const STATUS_LABELS = new Map(STATUSES.map((status) => [status.key, status.label]));
const ISSUE_TYPE_OPTIONS = ["", "Bug", "Inquiry", "Purchase", "Feature Request", "After-sales"];
const ISSUE_PROGRESS_OPTIONS = [
  "",
  "New",
  "Initial reply sent",
  "Waiting for user",
  "Forwarded",
  "Discussion ongoing",
  "Engineer checking",
  "Closed",
  "Archived",
];
const KNOWN_MODEL_OPTIONS = [
  "A3",
  "DM-32UV",
  "EZTalk65",
  "H1",
  "H103",
  "H103ML",
  "HA1G",
  "HA1UV",
  "HA2",
  "HD1",
  "HD2",
  "MA1",
  "RA89",
];

const EDITABLE_FIELD_DEFS = [
  { header: "Date", key: "date", type: "input", inputType: "text" },
  { header: "Source", key: "source", type: "input" },
  { header: "Email", key: "email", type: "input" },
  { header: "User ID", key: "userId", type: "input" },
  { header: "Model", key: "model", type: "input" },
  { header: "Country", key: "country", type: "input" },
  { header: "Module", key: "module", type: "select", options: ["", "Firmware", "CPS", "APP", "Hardware", "Accessory", "Support", "Documentation", "Other"] },
  { header: "Issue Type", key: "issueType", type: "select", options: ISSUE_TYPE_OPTIONS },
  { header: "Key Issue", key: "keyIssue", type: "textarea", rows: 3, size: "wide" },
  { header: "Severity", key: "severity", type: "select", options: ["", "High", "Medium", "Low"] },
  { header: "User Emotion", key: "userEmotion", type: "select", options: ["", "Calm", "Dissatisfied", "Confused", "Urgent", "Curious", "Frustrated"] },
  { header: "Needs Reply", key: "needsReply", type: "select", options: ["", "Yes", "No"] },
  { header: "Response Date", key: "responseDate", type: "input", inputType: "text" },
  { header: "Issue Progress", key: "issueProgress", type: "select", options: ISSUE_PROGRESS_OPTIONS },
  { header: "Handler", key: "handler", type: "input" },
  { header: "Communication Progress", key: "communicationProgress", type: "textarea", rows: 2, size: "wide" },
  { header: "Issue Number", key: "issueNumber", type: "input" },
  { header: "Tags", key: "tags", type: "input", size: "wide" },
  { header: "Suggested Reply", key: "suggestedReply", type: "textarea", rows: 4, size: "wide" },
  { header: "Info Needed", key: "infoNeeded", type: "textarea", rows: 3, size: "wide" },
  { header: "Internal Recommendation", key: "internalRecommendation", type: "textarea", rows: 3, size: "wide" },
  { header: "More Info", key: "moreInfo", type: "textarea", rows: 3, size: "wide" },
];

const DETAIL_FIELD_GROUPS = [
  { title: "Issue Summary", headers: ["Key Issue"] },
  { title: "User Info", headers: ["Date", "Source", "Email", "User ID", "Country"] },
  { title: "Product & Classification", headers: ["Model", "Module", "Issue Type", "Severity", "User Emotion", "Tags"] },
  { title: "Workflow", headers: ["Needs Reply", "Response Date", "Issue Progress", "Handler", "Issue Number"] },
  { title: "Notes", headers: ["Communication Progress", "Suggested Reply", "Info Needed", "Internal Recommendation", "More Info"] },
];

const EDITABLE_FIELD_BY_HEADER = new Map(EDITABLE_FIELD_DEFS.map((field) => [field.header, field]));
const FIELD_TO_RECORD_KEY = Object.fromEntries(EDITABLE_FIELD_DEFS.map((field) => [field.header, field.key]));
const MULTILINE_FIELD_HEADERS = new Set([
  ...EDITABLE_FIELD_DEFS.filter((field) => field.type === "textarea").map((field) => field.header),
  "Raw User Feedback",
  "Detail",
  "Chinese",
]);
const NEW_ISSUE_FIELD_HEADERS = [
  "Date",
  "Source",
  "Email",
  "User ID",
  "Model",
  "Country",
  "Module",
  "Issue Type",
  "Severity",
  "User Emotion",
  "Needs Reply",
  "Issue Progress",
  "Handler",
  "Issue Number",
  "Key Issue",
  "Detail",
  "Chinese",
  "Tags",
  "Suggested Reply",
  "Info Needed",
  "Internal Recommendation",
  "More Info",
];

let allIssues = [];
let summaryFilter = "all";
let pendingIssueRefresh = false;
let activeFilters = {
  year: "All Years",
  model: "All Models",
  module: "All Modules",
  severity: "All Severity",
  dateFrom: "",
  dateTo: "",
  search: "",
};

function deriveStatus(row) {
  return deriveStatusFromFields(row["Issue Progress"], row["Issue Number"]);
}

function deriveStatusFromProgress(value) {
  return deriveStatusFromFields(value, "");
}

function deriveStatusFromFields(progressValue, issueNumberValue) {
  const progress = normalizeText(progressValue).toLowerCase();
  const issueNumber = normalizeText(issueNumberValue);
  if (progress === "new") return "submit";
  if ([
    "waiting for user",
    "need more info",
    "discussion ongoing",
    "forwarded",
    "reported to engineer",
    "engineer checking",
    "fix planned",
  ].includes(progress)) {
    return "progress";
  }
  if (["closed", "fixed / closed"].includes(progress)) return "resolved";
  if (progress === "archived") return "archived";
  if (progress === "initial reply sent") return "submitted";
  if (/\d/.test(issueNumber)) return "submitted";
  if (!progress) return "submit";
  return "submit";
}

function normalizeRows(rows, year) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const headers = rows[0].map(normalizeText);
  const normalizedHeaderMap = buildHeaderMap(headers);
  return rows
    .slice(2)
    .map((row, index) => {
      const raw = {};
      headers.forEach((header, cellIndex) => {
        if (header) raw[header] = normalizeFieldValue(header, row[cellIndex]);
      });

      const record = {
        id: `${year}-${index + 3}`,
        year,
        rowNumber: index + 3,
        date: readField(raw, row, normalizedHeaderMap, 0, ["Date"]),
        source: readField(raw, row, normalizedHeaderMap, 1, ["Source"]),
        email: readField(raw, row, normalizedHeaderMap, 2, ["Email"]),
        userId: readField(raw, row, normalizedHeaderMap, 3, ["User ID", "UserID"]),
        model: readField(raw, row, normalizedHeaderMap, 4, ["Model", "Product Model"]),
        country: readField(raw, row, normalizedHeaderMap, 5, ["Country"]),
        module: readField(raw, row, normalizedHeaderMap, 6, ["Module"]),
        keyIssue: readField(raw, row, normalizedHeaderMap, 7, ["Key Issue", "KeyIssue", "Key Points"]),
        detail: readField(raw, row, normalizedHeaderMap, 8, ["Detail"]),
        chinese: readField(raw, row, normalizedHeaderMap, 9, ["Chinese"]),
        issueType: readField(raw, row, normalizedHeaderMap, 10, ["Issue Type", "IssueType"]),
        firmwareVersion: readField(raw, row, normalizedHeaderMap, 11, ["Firmware Version"]),
        appCpsVersion: readField(raw, row, normalizedHeaderMap, 12, ["APP/CPS Version", "APP CPS Version"]),
        severity: readField(raw, row, normalizedHeaderMap, 13, ["Severity"]),
        userEmotion: readField(raw, row, normalizedHeaderMap, 14, ["User Emotion", "Emotion"]),
        needsReply: readField(raw, row, normalizedHeaderMap, 15, ["Needs Reply"]),
        suggestedReply: readField(raw, row, normalizedHeaderMap, 16, ["Suggested Reply"]),
        infoNeeded: readField(raw, row, normalizedHeaderMap, 17, ["Info Needed"]),
        internalRecommendation: readField(raw, row, normalizedHeaderMap, 18, ["Internal Recommendation"]),
        responseDate: readField(raw, row, normalizedHeaderMap, 19, ["Response Date"]),
        issueProgress: readField(raw, row, normalizedHeaderMap, 20, ["Issue Progress"]),
        handler: readField(raw, row, normalizedHeaderMap, 21, ["Handler"]),
        communicationProgress: readField(raw, row, normalizedHeaderMap, 22, ["Communication Progress"]),
        moreInfo: readField(raw, row, normalizedHeaderMap, 23, ["More Info"]),
        issueNumber: readField(raw, row, normalizedHeaderMap, 24, ["Issue Number", "Issue #"]),
        tags: readField(raw, row, normalizedHeaderMap, 25, ["Tags"]),
        lastModifiedAt: readField(raw, row, normalizedHeaderMap, undefined, ["Last Modified At"]),
        lastModifiedBy: readField(raw, row, normalizedHeaderMap, undefined, ["Last Modified By"]),
        editLog: readField(raw, row, normalizedHeaderMap, undefined, ["Edit Log"]),
      };

      record.status = deriveStatusFromFields(record.issueProgress, record.issueNumber);
      return record;
    })
    .filter((record) =>
      [
        record.date,
        record.model,
        record.keyIssue,
        record.detail,
        record.chinese,
        record.issueNumber,
      ].some(Boolean),
    );
}

function buildHeaderMap(headers) {
  return headers.reduce((map, header, index) => {
    const key = normalizeHeaderKey(header);
    if (key && !map.has(key)) map.set(key, index);
    return map;
  }, new Map());
}

function readField(raw, row, headerMap, fallbackIndex, names) {
  for (const name of names) {
    const directValue = raw[name];
    if (directValue) return directValue;

    const mappedIndex = headerMap.get(normalizeHeaderKey(name));
    if (mappedIndex !== undefined) {
      const mappedValue = normalizeFieldValue(name, row[mappedIndex]);
      if (mappedValue) return mappedValue;
    }
  }

  return normalizeFieldValue(names[0], row[fallbackIndex]);
}

function normalizeHeaderKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function summarizeIssues(records) {
  const statusCounts = Object.fromEntries(STATUSES.map((status) => [status.key, 0]));
  records.forEach((record) => {
    statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;
  });

  return {
    total: records.length,
    statusCounts,
  };
}

function filterIssues(records, filters = {}) {
  const search = normalizeText(filters.search).toLowerCase();

  return records.filter((record) => {
    if (isConcrete(filters.year, "All Years") && record.year !== filters.year) return false;
    if (isConcrete(filters.model, "All Models") && !recordMatchesModel(record, filters.model)) return false;
    if (isConcrete(filters.module, "All Modules") && record.module !== filters.module) return false;
    if (isConcrete(filters.severity, "All Severity") && record.severity !== filters.severity) return false;
    if (!isWithinDateRange(record.date, filters.dateFrom, filters.dateTo)) return false;
    if (!search) return true;

    return [
      record.date,
      record.source,
      record.email,
      record.userId,
      record.model,
      record.module,
      record.keyIssue,
      record.detail,
      record.chinese,
      record.issueType,
      record.severity,
      record.userEmotion,
      record.handler,
      record.issueNumber,
      record.tags,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
}

function isWithinDateRange(dateValue, dateFrom, dateTo) {
  const recordDate = parseDateKey(dateValue);
  const fromDate = parseDateKey(dateFrom);
  const toDate = parseDateKey(dateTo);

  if (!fromDate && !toDate) return true;
  if (!recordDate) return false;
  if (fromDate && recordDate < fromDate) return false;
  if (toDate && recordDate > toDate) return false;
  return true;
}

function parseDateKey(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const isoMatch = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const usMatch = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

function uniqueOptions(records, field) {
  return [...new Set(records.map((record) => normalizeText(record[field])).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "en", { numeric: true }),
  );
}

function modelOptions(records) {
  return [
    ...new Set(records.flatMap((record) => canonicalModels(record.model))),
  ].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function canonicalModels(value) {
  const normalized = normalizeModelText(value);
  if (!normalized) return [];
  return KNOWN_MODEL_OPTIONS.filter((model) => modelPattern(model).test(normalized));
}

function normalizeModelText(value) {
  return normalizeText(value)
    .replace(/[，、]/g, ",")
    .replace(/\bUV\b/gi, "HA1UV")
    .replace(/\bDM\s*32UV\b/gi, "DM-32UV")
    .toUpperCase();
}

function modelPattern(model) {
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\-", "[- ]?");
  return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i");
}

function recordMatchesModel(record, selectedModel) {
  return canonicalModels(record.model).includes(selectedModel);
}

function formatPercent(count, total) {
  if (!total) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

function editableIssueValues(record) {
  return EDITABLE_FIELD_DEFS.reduce((values, field) => {
    values[field.header] = normalizeFieldValue(field.header, record[field.key]);
    return values;
  }, {});
}

function changedIssueFields(record, currentValues) {
  const original = editableIssueValues(record);
  return Object.entries(currentValues).reduce((changes, [field, value]) => {
    if (!Object.prototype.hasOwnProperty.call(original, field)) return changes;
    const nextValue = normalizeFieldValue(field, value);
    if ((original[field] || "") !== nextValue) {
      changes[field] = nextValue;
    }
    return changes;
  }, {});
}

function issueIdentity(record) {
  return {
    year: record.year,
    rowNumber: record.rowNumber,
    date: normalizeFieldValue("Date", record.date),
    email: normalizeFieldValue("Email", record.email),
    userId: normalizeFieldValue("User ID", record.userId),
    model: normalizeFieldValue("Model", record.model),
    keyIssue: normalizeFieldValue("Key Issue", record.keyIssue),
    issueNumber: normalizeFieldValue("Issue Number", record.issueNumber),
  };
}

function sheetRowsConfirmIssueChanges(rows, record, changes) {
  if (!Array.isArray(rows) || rows.length < 3) return false;
  const headers = rows[0].map(normalizeText);
  const headerMap = buildHeaderMap(headers);
  const original = editableIssueValues(record);
  const identityHeaders = ["Issue Number", "Date", "Email", "User ID", "Model", "Key Issue"];
  const stableIdentity = identityHeaders.filter((header) => {
    const value = original[header];
    return value && value !== "-" && value.toLowerCase() !== "missing" && changes[header] === undefined;
  });

  return rows.slice(2).some((row) => {
    const matchesField = ([header, expected]) => {
      const index = headerMap.get(normalizeHeaderKey(header));
      if (index === undefined) return false;
      return normalizeFieldValue(header, row[index]) === normalizeFieldValue(header, expected);
    };
    if (stableIdentity.length && !stableIdentity.every((header) => matchesField([header, original[header]]))) {
      return false;
    }
    return Object.entries(changes).every(matchesField);
  });
}

function newIssueValuesFromFormData(formValues) {
  return NEW_ISSUE_FIELD_HEADERS.reduce((values, header) => {
    if (Object.prototype.hasOwnProperty.call(formValues, header)) {
      values[header] = normalizeFieldValue(header, formValues[header]);
    }
    return values;
  }, {});
}

function targetSheetNameForIssue(values) {
  const year = parseDateKey(values.Date).slice(0, 4);
  if (SHEET_NAMES.includes(year)) return year;
  return SHEET_NAMES[0];
}

function updateIssueRecordLocally(record, { changes = {}, result = {} } = {}) {
  Object.entries(changes).forEach(([field, value]) => {
    const key = FIELD_TO_RECORD_KEY[field];
    if (key) record[key] = normalizeFieldValue(field, value);
  });
  if (changes["Issue Progress"] !== undefined || changes["Issue Number"] !== undefined) {
    record.status = deriveStatusFromFields(record.issueProgress, record.issueNumber);
  }
  if (result.lastModifiedAt !== undefined) record.lastModifiedAt = normalizeText(result.lastModifiedAt);
  if (result.lastModifiedBy !== undefined) record.lastModifiedBy = normalizeText(result.lastModifiedBy);
  if (result.editLog !== undefined) record.editLog = normalizeText(result.editLog);
  return record;
}

function isConcrete(value, allLabel) {
  return value && value !== allLabel;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeFieldValue(header, value) {
  return MULTILINE_FIELD_HEADERS.has(header) ? normalizeMultilineText(value) : normalizeText(value);
}

function splitMultiValue(value) {
  return normalizeText(value)
    .split(/[,，;；]/)
    .map(normalizeText)
    .filter(Boolean);
}

function slugify(value) {
  return normalizeHeaderKey(value) || "none";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function analyzeRawIssue(rawText, options = {}) {
  const detail = normalizeText(rawText);
  const lower = detail.toLowerCase();
  const date = extractDate(detail) || options.today || todayIsoDate();
  const email = detail.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const model = extractModel(detail);
  const module = classifyModule(lower);
  const issueType = classifyIssueType(lower);
  const severity = classifySeverity(lower, issueType);
  const userEmotion = classifyEmotion(lower, issueType);
  const tags = extractTags(detail, module, issueType);

  return {
    date,
    source: email ? "Email" : "",
    email,
    userId: extractUserId(detail, email),
    model,
    country: "",
    module,
    issueType,
    keyIssue: buildKeyIssue({ detail, model, module, issueType, tags }),
    detail,
    chinese: draftChinese(detail, { model, module, issueType, tags }),
    severity,
    userEmotion,
    needsReply: "Yes",
    responseDate: "",
    issueProgress: "New",
    handler: "Julia",
    communicationProgress: "",
    issueNumber: "",
    tags,
    suggestedReply: "",
    infoNeeded: "",
    internalRecommendation: "",
    moreInfo: "",
  };
}

function extractDate(text) {
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

function extractModel(text) {
  const match = normalizeText(text).match(/\b(HA1UV|HA1G|HA2|HD2|HD1|H1|RA89|MA1|DM-?32UV|H103|H103ML)\b/i);
  return match ? match[1].toUpperCase().replace("DM-32UV", "DM-32UV") : "";
}

function classifyModule(lower) {
  if (/(cps|codeplug|programming software|csv|excel|chirp)/i.test(lower)) return "CPS";
  if (/(app|ios|android|bluetooth app|mobile app|aprsdroid)/i.test(lower)) return "APP";
  if (/(firmware|update|upgrade|program mode|bootloader|screen|display|channel mode|dmr|audio|modulation|tx|rx|repeater|kiss|tnc|aprs)/i.test(lower)) return "Firmware";
  if (/(antenna|battery|charging|charger|speaker|mic|microphone|knob|ptt|cable|usb|case|waterproof|hardware)/i.test(lower)) return "Hardware";
  return "Other";
}

function classifyIssueType(lower) {
  if (/(amazon|order|refund|return|warranty|repair|missing|arrived|shipment|delivery|defective unit|after[- ]?sales)/i.test(lower)) return "After-sales";
  if (/(feature request|please add|wish|would like|hope|can you add|support .* in future|request)/i.test(lower)) return "Feature Request";
  if (/(bug|problem|issue|error|fail|fails|failed|not work|doesn't work|cannot|can't|stuck|jump|skip|wrong|abnormal|no audio|not loud|interference|noise|crash)/i.test(lower)) return "Bug";
  if (/(buy|price|in stock|stock|where can i get|where can i buy|purchase link|buy link|available|availability)/i.test(lower)) return "Purchase";
  return "Inquiry";
}

function classifySeverity(lower, issueType) {
  if (issueType === "After-sales") return "Medium";
  if (/(brick|dead|cannot power|won't power|no transmit|emergency|urgent|safety|refund|replacement)/i.test(lower)) return "High";
  if (issueType === "Bug") return "Medium";
  return "Low";
}

function classifyEmotion(lower, issueType) {
  if (/(urgent|asap|immediately|right now)/i.test(lower)) return "Urgent";
  if (/(frustrat|angry|annoy|disappoint|dissatisfied|not happy)/i.test(lower)) return "Dissatisfied";
  if (/(confus|wonder|not sure|how do i|how to|why)/i.test(lower)) return "Confused";
  if (issueType === "Inquiry" || /\?/.test(lower)) return "Curious";
  return "Calm";
}

function extractTags(text, module, issueType) {
  const lower = text.toLowerCase();
  const tags = new Set([module, issueType].filter(Boolean));
  const tagRules = [
    ["APRS", /aprs/i],
    ["KISS TNC", /kiss|tnc/i],
    ["Bluetooth", /bluetooth|ble/i],
    ["CHIRP", /chirp/i],
    ["DMR", /\bdmr\b/i],
    ["Audio", /audio|modulation|mic|microphone|speaker|loud/i],
    ["RF", /\brf\b|interference|noise|tx|rx|transmit|receive/i],
    ["Firmware Update", /firmware|update|upgrade|program mode/i],
    ["Antenna", /antenna/i],
    ["Battery", /battery|charging|charger/i],
    ["Amazon", /amazon/i],
    ["Website", /website|web site|official site|retevis\.com|ailunce\.com/i],
  ];
  tagRules.forEach(([tag, pattern]) => {
    if (pattern.test(lower)) tags.add(tag);
  });
  return [...tags].join(", ");
}

function extractUserId(text, email) {
  const signature = text.match(/(?:best|thanks|thank you|regards|73)[,\s]+([A-Z][A-Za-z .'-]{1,40})$/i);
  if (signature) return normalizeText(signature[1]);
  if (email) return email.split("@")[0];
  return "";
}

function buildKeyIssue({ detail, model, module, issueType, tags }) {
  const clean = detail.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").trim();
  const sentences = clean.split(/(?<=[.!?。！？])\s+/).map(normalizeText).filter(Boolean);
  const issueSentence =
    sentences.find((sentence) => /(bug|problem|issue|error|fail|not work|doesn't work|cannot|can't|stuck|jump|skip|wrong|abnormal|not loud|interference|noise)/i.test(sentence)) ||
    sentences[0] ||
    clean;
  const firstSentence = normalizeText(issueSentence).slice(0, 150);
  const prefix = [model, module, issueType].filter(Boolean).join(" ");
  return normalizeText(`${prefix}: ${firstSentence || "New user issue requires review"}`);
}

function draftChinese(detail, { model, module, issueType, tags }) {
  const clean = normalizeText(detail);
  if (!clean) return "";
  const summaries = [];
  if (model) summaries.push(`用户提到 ${model}`);
  if (issueType === "Bug") summaries.push("反馈产品或功能存在异常");
  if (issueType === "Inquiry") summaries.push("咨询功能使用、参数或兼容性");
  if (issueType === "Purchase") summaries.push("咨询购买、库存或配件信息");
  if (issueType === "Feature Request") summaries.push("提出功能新增或改进需求");
  if (issueType === "After-sales") summaries.push("需要售后、订单、退换或维修处理");
  if (module) summaries.push(`相关模块为 ${module}`);
  return `${summaries.join("，")}。原文：${clean}`;
}

function googleTableToRows(table) {
  const bodyRows = (table?.rows || []).map((row) =>
    (row.c || []).map((cell) => normalizeText(cell?.f ?? cell?.v)),
  );
  const headers = (table?.cols || []).map((column) => normalizeText(column?.label));

  if (headers.some(Boolean)) return [headers, ...bodyRows];
  return bodyRows;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function loadSheet(sheetName) {
  return loadSheetViaAppsScript(sheetName).catch(() => {
    return loadSheetFromPublicView(sheetName);
  });
}

function loadSheetFromPublicView(sheetName, attempt = 0) {
  return loadSheetOnce(sheetName, attempt).catch((error) => {
    const delay = SHEET_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) throw error;
    return wait(delay).then(() => loadSheetFromPublicView(sheetName, attempt + 1));
  });
}

async function loadSheetViaAppsScript(sheetName, originalError) {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    throw originalError || new Error("Google Apps Script URL is not configured yet.");
  }
  try {
    const result = await callAppsScript({ action: "sheetRows", sheetName });
    return normalizeRows(result.rows || [], sheetName);
  } catch (error) {
    throw originalError || error;
  }
}

async function loadSheetForSaveVerification(sheetName) {
  try {
    return await loadSheetOnce(sheetName, 0);
  } catch (publicError) {
    return loadSheetViaAppsScript(sheetName, publicError);
  }
}

function loadSheetOnce(sheetName, attempt) {
  return new Promise((resolve, reject) => {
    const callbackName = `__juliaIssueSheet_${sheetName}_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`;
    const url = new URL(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`);
    url.searchParams.set("sheet", sheetName);
    url.searchParams.set("tq", "select *");
    url.searchParams.set("tqx", `out:json;responseHandler:${callbackName}`);
    url.searchParams.set("_", `${Date.now()}-${attempt}`);

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Google Sheet ${sheetName} did not respond. Check sharing access.`));
    }, SHEET_LOAD_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (payload?.status === "error") {
        reject(new Error(payload?.errors?.[0]?.detailed_message || `Unable to load ${sheetName}.`));
        return;
      }
      resolve(normalizeRows(googleTableToRows(payload.table), sheetName));
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`Unable to load Google Sheet ${sheetName}.`));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function mergeSheetResults(results) {
  const records = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  const failures = results.filter((result) => result.status === "rejected");
  const firstError = failures[0]?.reason;

  return {
    records,
    failedSheets: failures.length,
    ok: records.length > 0,
    message: firstError?.message || "Unable to load Google Sheets data.",
  };
}

async function loadIssues() {
  setSyncStatus("Syncing", false);
  setBoardMessage("Loading Google Sheets data...");

  const result = mergeSheetResults(await Promise.allSettled(SHEET_NAMES.map(loadSheet)));

  if (result.ok) {
    allIssues = result.records;
    populateFilters(result.records);
    render();
    setSyncStatus(result.failedSheets ? "Partial Sync" : "Synced", !result.failedSheets);
    return;
  }

  console.error(result.message);
    allIssues = [];
    setSyncStatus("Sheet Error", false);
    renderKpis([]);
    renderBoard([]);
    setBoardMessage(result.message);
}

function populateFilters(records) {
  renderSelect("year-filter", ["2026", "2025"], "All Years");
  renderSelect("model-filter", modelOptions(records), "All Models");
  renderSelect("module-filter", uniqueOptions(records, "module"), "All Modules");
  renderSelect("severity-filter", uniqueOptions(records, "severity"), "All Severity");
}

function renderSelect(id, options, allLabel) {
  const select = document.getElementById(id);
  if (!select) return;

  const current = select.value || allLabel;
  select.innerHTML = [allLabel, ...options]
    .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
    .join("");
  select.value = options.includes(current) || current === allLabel ? current : allLabel;
}

function readFilters() {
  activeFilters = {
    year: document.getElementById("year-filter")?.value || "All Years",
    model: document.getElementById("model-filter")?.value || "All Models",
    module: document.getElementById("module-filter")?.value || "All Modules",
    severity: document.getElementById("severity-filter")?.value || "All Severity",
    dateFrom: document.getElementById("date-from-filter")?.value || "",
    dateTo: document.getElementById("date-to-filter")?.value || "",
    search: document.getElementById("keyword-search")?.value || "",
  };
}

function render() {
  readFilters();
  const filteredRecords = filterIssues(allIssues, activeFilters);
  const records = filterBySummary(filteredRecords);
  setBoardMessage("");
  renderKpis(filteredRecords);
  renderBoard(records);
  updateShowingLabel(records);
}

function filterBySummary(records) {
  if (!summaryFilter || summaryFilter === "all") return records;
  return records.filter((record) => record.status === summaryFilter);
}

function renderKpis(records) {
  const summary = summarizeIssues(records);
  setText("total-count", summary.total);

  STATUSES.forEach((status) => {
    const count = summary.statusCounts[status.key] || 0;
    setText(`${status.key}-count`, count);
    setText(`${status.key}-percent`, formatPercent(count, summary.total));
  });
}

function renderBoard(records) {
  STATUSES.forEach((status) => {
    const laneRecords = records.filter((record) => record.status === status.key);
    setText(`${status.key}-lane-count`, laneRecords.length);
    const list = document.getElementById(`${status.key}-cards`);
    if (!list) return;

    if (!laneRecords.length) {
      list.innerHTML = `<p class="empty-card">No ${escapeHtml(status.label)} issues.</p>`;
      return;
    }

    list.innerHTML = laneRecords.slice(0, 8).map(renderIssueCard).join("");
  });
  bindCardEvents();
}

function renderIssueCard(record) {
  const severityClass = record.severity.toLowerCase() === "high" ? "high" : "";
  const issueNumber = record.issueNumber
    ? `<p class="issue-number">Issue # ${escapeHtml(record.issueNumber)}</p>`
    : "";
  const title = record.keyIssue || "Key issue missing";

  return `
    <article class="issue-card feedback-card" role="button" tabindex="0" data-record-id="${escapeHtml(record.id)}" aria-label="Open issue detail">
      <div class="card-topline">
        <div class="chips">
          ${record.module ? `<span>${escapeHtml(record.module)}</span>` : ""}
          ${record.severity ? `<span class="${severityClass}">${escapeHtml(record.severity)}</span>` : ""}
        </div>
        <span class="card-date">${escapeHtml(record.date || "No date")}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      ${issueNumber}
      <div class="card-context">
        <span class="model-badge">${escapeHtml(record.model || "No model")}</span>
        ${record.userEmotion ? `<span>${escapeHtml(record.userEmotion)}</span>` : ""}
      </div>
      <div class="card-actions">
        <span>${escapeHtml(record.handler || "Unassigned")}</span>
        <strong>Open <span aria-hidden="true">↗</span></strong>
      </div>
    </article>
  `;
}

function renderDetailHtml(record) {
  const meta = [record.date, record.userId || record.handler].filter(Boolean).join(" · ");
  const statusLabel = STATUS_LABELS.get(record.status) || "To Submit";
  const progressLabel = normalizeText(record.issueProgress) || "New";

  return `
    <div class="detail-panel__header">
      <div class="detail-header-tags">
        ${detailTag(record.model, "model")}
        ${detailTags(record.issueType, "issue-type")}
        ${detailTag(record.module, "module")}
        ${detailTag(record.severity, "severity")}
        ${detailTag(record.userEmotion, "emotion")}
      </div>
      <div class="detail-actions">
        <button class="copy-detail-summary" type="button">Copy Engineer Summary</button>
        <button class="close-detail" type="button" aria-label="Close detail">Close</button>
      </div>
    </div>
    <section class="detail-summary-card">
      <div class="detail-status-strip">
        <span class="status-pill">${escapeHtml(statusLabel)}</span>
        <span class="progress-pill"><b>Issue Progress</b>${escapeHtml(progressLabel)}</span>
      </div>
      <h2>${escapeHtml(record.keyIssue || "Issue detail")}</h2>
      ${meta ? `<p>${escapeHtml(meta)}</p>` : ""}
    </section>
    <section class="detail-readonly-section">
      ${readonlyDetailBlock("Original Feedback", record.detail)}
      ${readonlyDetailBlock("Chinese", record.chinese)}
    </section>
    ${detailEditableSections(record)}
    ${detailStaticSection("System Info", [
      ["Firmware Version", record.firmwareVersion],
      ["APP/CPS Version", record.appCpsVersion],
      ["Last Modified At", record.lastModifiedAt],
      ["Last Modified By", record.lastModifiedBy],
      ["Edit Log", summarizeEditLog(record.editLog), "wide"],
    ])}
    <button class="save-detail-changes" type="button">Save Changes</button>
  `;
}

function detailTag(value, type = "") {
  const text = normalizeText(value);
  if (!text) return "";
  const classes = ["detail-tag"];
  if (type) classes.push(`detail-tag--${type}`);
  classes.push(`detail-tag--${slugify(text)}`);
  return `<span class="${classes.map(escapeHtml).join(" ")}">${escapeHtml(text)}</span>`;
}

function detailTags(value, type = "") {
  return splitMultiValue(value)
    .map((item) => detailTag(item, type))
    .join("");
}

function readonlyDetailBlock(label, value) {
  return `
    <article>
      <h3>${escapeHtml(label)}</h3>
      <p>${escapeHtml(value || "-")}</p>
    </article>
  `;
}

function detailEditableSections(record) {
  return DETAIL_FIELD_GROUPS.map((group) => {
    const rows = group.headers
      .map((header) => EDITABLE_FIELD_BY_HEADER.get(header))
      .filter(Boolean)
      .map((field) => editableDetailRow(field, record))
      .join("");

    return detailSection(group.title, rows);
  }).join("");
}

function detailStaticSection(title, rows) {
  const html = rows.map(([label, value, size]) => detailRow(label, value, size)).join("");
  return detailSection(title, html);
}

function detailSection(title, rowsHtml) {
  if (!rowsHtml) return "";
  return `
    <section class="detail-field-section">
      <h3 class="detail-section-title">${escapeHtml(title)}</h3>
      <dl class="detail-list detail-edit-grid">
        ${rowsHtml}
      </dl>
    </section>
  `;
}

function editableDetailRow(field, record) {
  const value = normalizeFieldValue(field.header, record[field.key]);
  const size = field.size === "wide" ? "detail-row-wide" : "";
  return `
    <div class="detail-editable-row ${size}">
      <dt>${escapeHtml(field.header)}</dt>
      <dd>${fieldInputHtml(field, value)}</dd>
    </div>
  `;
}

function fieldInputHtml(field, value) {
  if (field.type === "select") {
    return `
      <select name="${escapeHtml(field.header)}">
        ${field.options
          .map((option) => `<option value="${escapeHtml(option)}"${value === option ? " selected" : ""}>${escapeHtml(option || "-")}</option>`)
          .join("")}
      </select>
    `;
  }

  if (field.type === "textarea") {
    return `<textarea name="${escapeHtml(field.header)}" rows="${field.rows || 3}" wrap="soft">${escapeHtml(value)}</textarea>`;
  }

  return `<input name="${escapeHtml(field.header)}" type="${escapeHtml(field.inputType || "text")}" value="${escapeHtml(value)}" />`;
}

function renderNewIssueHtml() {
  return `
    <div class="detail-panel__header">
      <div>
        <div class="chips"><span>Draft</span><span>Auto Analyze</span></div>
        <p class="detail-kicker">New Issue</p>
        <h2>Create a new issue draft</h2>
      </div>
      <button class="close-detail" type="button" aria-label="Close detail">×</button>
    </div>
    <form class="new-issue-form">
      <label>Raw User Feedback<textarea name="Raw User Feedback" rows="5" placeholder="Paste the user's original words..."></textarea></label>
      <button type="button" class="analyze-issue-button">Analyze Issue</button>
      <div class="new-issue-grid">
        <label>Date<input name="Date" type="date" /></label>
        <label>Source<input name="Source" placeholder="Email, Facebook, Amazon..." /></label>
        <label>Email<input name="Email" placeholder="user@example.com" /></label>
        <label>User ID<input name="User ID" placeholder="Name or username" /></label>
        <label>Model<input name="Model" placeholder="HA2, HA1UV, HD1..." /></label>
        <label>Country<input name="Country" placeholder="US, UK..." /></label>
        <label>Module<select name="Module"><option></option><option>Firmware</option><option>CPS</option><option>APP</option><option>Hardware</option><option>Other</option></select></label>
        <label>Issue Type<select name="Issue Type">${ISSUE_TYPE_OPTIONS.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type || "-")}</option>`).join("")}</select></label>
        <label>Severity<select name="Severity"><option></option><option>High</option><option>Medium</option><option>Low</option></select></label>
        <label>User Emotion<select name="User Emotion"><option></option><option>Calm</option><option>Dissatisfied</option><option>Confused</option><option>Urgent</option><option>Curious</option><option>Frustrated</option></select></label>
        <label>Needs Reply<select name="Needs Reply"><option>Yes</option><option>No</option></select></label>
        <label>Issue Progress<select name="Issue Progress">${ISSUE_PROGRESS_OPTIONS.map((progress) => `<option value="${escapeHtml(progress)}">${escapeHtml(progress || "-")}</option>`).join("")}</select></label>
        <label>Handler<input name="Handler" placeholder="Julia" /></label>
        <label>Issue Number<input name="Issue Number" placeholder="Generated after submission" /></label>
      </div>
      <label>Key Issue<textarea name="Key Issue" rows="3"></textarea></label>
      <label>Detail<textarea name="Detail" rows="4"></textarea></label>
      <label>Chinese<textarea name="Chinese" rows="4"></textarea></label>
      <label>Tags<input name="Tags" placeholder="Firmware, Bluetooth, APRS..." /></label>
      <label>Suggested Reply<textarea name="Suggested Reply" rows="3"></textarea></label>
      <label>Info Needed<textarea name="Info Needed" rows="3"></textarea></label>
      <label>Internal Recommendation<textarea name="Internal Recommendation" rows="3"></textarea></label>
      <label>More Info<textarea name="More Info" rows="3"></textarea></label>
      <p class="drawer-note">Analyze the raw text or fill Key Issue and Detail before saving.</p>
      <button type="button" class="save-new-issue">Save to Sheet</button>
    </form>
  `;
}

function detailRow(label, value, size = "") {
  return `
    <div class="${size === "wide" ? "detail-row-wide" : ""}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || "-")}</dd>
    </div>
  `;
}

function summarizeEditLog(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .split(/\n+/)
    .map((line) => summarizeEditLogLine(line))
    .filter(Boolean)
    .join("\n");
}

function summarizeEditLogLine(line) {
  const text = normalizeText(line);
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\s*·\s*([^:]+):\s*(.+)$/);
  if (!match) return text;

  const [, date, time, rawUser, rawSummary] = match;
  const user = rawUser.replace(/\s*\([^)]*\)/g, "").trim();
  if (/^Updated\s+/i.test(rawSummary) || /^Created issue$/i.test(rawSummary)) {
    return `${date} ${time} · ${user}: ${rawSummary}`;
  }

  const fields = rawSummary
    .split(";")
    .map((part) => normalizeText(part).split(":")[0].trim())
    .filter(Boolean);
  const uniqueFields = [...new Set(fields)];
  return `${date} ${time} · ${user}: Updated ${uniqueFields.join(", ") || "issue"}`;
}

function bindCardEvents() {
  document.querySelectorAll(".feedback-card").forEach((card) => {
    card.addEventListener("click", () => {
      openDetailById(card.dataset.recordId);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDetailById(card.dataset.recordId);
    });
  });
}

function openDetailById(id) {
  const record = allIssues.find((issue) => issue.id === id);
  if (!record) return;
  openDrawer(renderDetailHtml(record));
  bindDetailEditEvents(record);
}

function openNewIssue() {
  openDrawer(renderNewIssueHtml());
  bindNewIssueEvents();
}

function openDrawer(html) {
  const panel = document.getElementById("detail-panel");
  const backdrop = document.getElementById("detail-backdrop");
  if (!panel || !backdrop) return;
  panel.innerHTML = html;
  panel.classList.remove("is-hidden");
  backdrop.classList.remove("is-hidden");
  document.body.classList.add("detail-open");
  panel.querySelector(".close-detail")?.addEventListener("click", closeDrawer);
}

function closeDrawer() {
  document.getElementById("detail-panel")?.classList.add("is-hidden");
  document.getElementById("detail-backdrop")?.classList.add("is-hidden");
  document.body.classList.remove("detail-open");
  if (pendingIssueRefresh) {
    pendingIssueRefresh = false;
    loadIssues();
  }
}

function bindNewIssueEvents() {
  document.querySelector(".analyze-issue-button")?.addEventListener("click", () => {
    const rawField = document.querySelector('[name="Raw User Feedback"]');
    const rawText = rawField?.value || "";
    if (!normalizeText(rawText)) {
      showToast("Paste raw user feedback first.");
      return;
    }
    fillNewIssueFields(analyzeRawIssue(rawText));
    showToast("Issue draft analyzed");
  });

  document.querySelector(".save-new-issue")?.addEventListener("click", async () => {
    const values = newIssueFieldValues();
    if (!values["Key Issue"] || !values.Detail) {
      showToast("Analyze or enter Key Issue and Detail first.");
      return;
    }

    const confirmed = window.confirm(`Create new issue in ${targetSheetNameForIssue(values)} sheet?`);
    if (!confirmed) return;

    setNewIssueSaving(true);
    try {
      const result = await createIssueInGoogleSheet(values);
      addOptimisticIssueRecord(result.record);
      pendingIssueRefresh = result.verified;
      showToast(result.verified ? "New issue saved" : "New issue saved. Shown locally until next sync.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Create failed");
    } finally {
      setNewIssueSaving(false);
    }
  });
}

function fillNewIssueFields(issue) {
  const fieldMap = {
    Date: issue.date,
    Source: issue.source,
    Email: issue.email,
    "User ID": issue.userId,
    Model: issue.model,
    Country: issue.country,
    Module: issue.module,
    "Issue Type": issue.issueType,
    Severity: issue.severity,
    "User Emotion": issue.userEmotion,
    "Needs Reply": issue.needsReply,
    "Issue Progress": issue.issueProgress,
    Handler: issue.handler,
    "Issue Number": issue.issueNumber,
    "Key Issue": issue.keyIssue,
    Detail: issue.detail,
    Chinese: issue.chinese,
    Tags: issue.tags,
    "Suggested Reply": issue.suggestedReply,
    "Info Needed": issue.infoNeeded,
    "Internal Recommendation": issue.internalRecommendation,
    "More Info": issue.moreInfo,
  };
  Object.entries(fieldMap).forEach(([name, value]) => {
    const field = namedFormField(name);
    if (field) field.value = value || "";
  });
}

function namedFormField(name) {
  const panel = document.getElementById("detail-panel") || document;
  return [...panel.querySelectorAll("[name]")].find((field) => field.name === name);
}

function newIssueFieldValues() {
  const form = document.querySelector(".new-issue-form");
  if (!form) return {};
  const values = {};
  form.querySelectorAll("input, select, textarea").forEach((field) => {
    if (field.name === "Raw User Feedback") return;
    values[field.name] = normalizeFieldValue(field.name, field.value);
  });
  return newIssueValuesFromFormData(values);
}

function detailFieldValues() {
  const panel = document.getElementById("detail-panel");
  if (!panel) return {};
  const values = {};
  panel.querySelectorAll(".detail-editable-row input, .detail-editable-row select, .detail-editable-row textarea").forEach((field) => {
    if (field.type === "checkbox") {
      if (!values[field.name]) values[field.name] = [];
      if (field.checked) values[field.name].push(normalizeText(field.value));
      return;
    }
    values[field.name] = normalizeFieldValue(field.name, field.value);
  });
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) values[key] = value.join(", ");
  });
  return values;
}

function bindDetailEditEvents(record) {
  document.querySelector(".copy-detail-summary")?.addEventListener("click", async () => {
    await copyEngineerSummary(record);
    showToast("Engineer summary copied");
  });

  document.querySelector(".save-detail-changes")?.addEventListener("click", async () => {
    const changes = changedIssueFields(record, detailFieldValues());
    if (!Object.keys(changes).length) {
      showToast("No editable changes to save.");
      return;
    }

    const confirmed = window.confirm(`Confirm changes?\n\n${changesSummary(record, changes)}`);
    if (!confirmed) return;

    setDetailSaving(true);
    try {
      const result = await syncIssueChangesToGoogleSheet(record, changes);
      updateIssueRecordLocally(record, { changes, result });
      render();
      openDrawer(renderDetailHtml(record));
      bindDetailEditEvents(record);
      showToast("Changes saved");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Update failed");
    } finally {
      setDetailSaving(false);
    }
  });
}

async function copyEngineerSummary(record) {
  const text = [
    `Key Issue: ${record.keyIssue || "-"}`,
    `Model: ${record.model || "-"}`,
    `Module: ${record.module || "-"}`,
    `Issue Type: ${record.issueType || "-"}`,
    `Severity: ${record.severity || "-"}`,
    `Issue Progress: ${record.issueProgress || STATUS_LABELS.get(record.status) || "-"}`,
    `Issue Number: ${record.issueNumber || "-"}`,
    `Original Feedback: ${record.detail || "-"}`,
    `Chinese: ${record.chinese || "-"}`,
  ].join("\n");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
  return text;
}

function setDetailSaving(isSaving) {
  const panel = document.getElementById("detail-panel");
  const button = panel?.querySelector(".save-detail-changes");
  const fields = panel?.querySelectorAll(".detail-editable-row input, .detail-editable-row select, .detail-editable-row textarea") || [];
  if (button) {
    button.disabled = isSaving;
    button.textContent = isSaving ? "Saving..." : "Save Changes";
  }
  fields.forEach((field) => {
    field.disabled = isSaving;
  });
}

function changesSummary(record, changes) {
  const original = editableIssueValues(record);
  return Object.entries(changes)
    .map(([field, value]) => `${field}: ${original[field] || "-"} -> ${value || "-"}`)
    .join("\n");
}

async function syncIssueChangesToGoogleSheet(record, changes) {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    throw new Error("Google Apps Script URL is not configured yet.");
  }
  const authToken = await ensureAuthToken();
  try {
    await callAppsScriptPost({
      action: "updateIssueFields",
      authToken,
      match: JSON.stringify(issueIdentity(record)),
      changes: JSON.stringify(changes),
    });
    await verifyIssueChangesInGoogleSheet(record, changes);
    return { ok: true, verified: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/session|permission|invalid account|password|sign in/i.test(message)) {
      window.localStorage?.removeItem(AUTH_TOKEN_KEY);
    }
    throw error;
  }
}

async function verifyIssueChangesInGoogleSheet(record, changes) {
  let lastError;
  for (const delay of [0, 1000, 2200]) {
    if (delay) await wait(delay);
    try {
      const result = await callAppsScript({ action: "sheetRows", sheetName: record.year });
      if (sheetRowsConfirmIssueChanges(result.rows, record, changes)) return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw new Error("The update may have been sent, but Google Sheet could not be verified. Refresh and try again.");
  }
  throw new Error("Google Sheet did not save these changes. Redeploy the latest Apps Script and try again.");
}

async function createIssueInGoogleSheet(values) {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    throw new Error("Google Apps Script URL is not configured yet.");
  }
  const authToken = await ensureAuthToken();
  const sheetName = targetSheetNameForIssue(values);
  const optimisticRecord = optimisticIssueRecordFromValues(values, sheetName);
  try {
    await callAppsScriptPost({
      action: "createIssue",
      authToken,
      sheetName,
      values: JSON.stringify(values),
    });
    return { ok: true, verified: false, record: optimisticRecord };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/session|permission|invalid account|password|sign in/i.test(message)) {
      window.localStorage?.removeItem(AUTH_TOKEN_KEY);
    }
    throw error;
  }
}

function optimisticIssueRecordFromValues(values, sheetName = targetSheetNameForIssue(values)) {
  const record = {
    id: `${sheetName}-new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    year: sheetName,
    rowNumber: 3,
    date: normalizeText(values.Date),
    source: normalizeText(values.Source),
    email: normalizeText(values.Email),
    userId: normalizeText(values["User ID"]),
    model: normalizeText(values.Model),
    country: normalizeText(values.Country),
    module: normalizeText(values.Module),
    keyIssue: normalizeFieldValue("Key Issue", values["Key Issue"]),
    detail: normalizeFieldValue("Detail", values.Detail),
    chinese: normalizeFieldValue("Chinese", values.Chinese),
    issueType: normalizeText(values["Issue Type"]),
    firmwareVersion: "",
    appCpsVersion: "",
    severity: normalizeText(values.Severity),
    userEmotion: normalizeText(values["User Emotion"]),
    needsReply: normalizeText(values["Needs Reply"]),
    suggestedReply: normalizeFieldValue("Suggested Reply", values["Suggested Reply"]),
    infoNeeded: normalizeFieldValue("Info Needed", values["Info Needed"]),
    internalRecommendation: normalizeFieldValue("Internal Recommendation", values["Internal Recommendation"]),
    responseDate: normalizeText(values["Response Date"]),
    issueProgress: normalizeText(values["Issue Progress"]),
    handler: normalizeText(values.Handler),
    communicationProgress: normalizeFieldValue("Communication Progress", values["Communication Progress"]),
    moreInfo: normalizeFieldValue("More Info", values["More Info"]),
    issueNumber: normalizeText(values["Issue Number"]),
    tags: normalizeText(values.Tags),
    lastModifiedAt: "",
    lastModifiedBy: "",
    editLog: "Pending next sheet sync.",
    isOptimistic: true,
  };
  record.status = deriveStatusFromFields(record.issueProgress, record.issueNumber);
  return record;
}

function addOptimisticIssueRecord(record) {
  if (!record) return;
  const exists = allIssues.some(
    (issue) =>
      issue.year === record.year &&
      normalizeText(issue.date) === normalizeText(record.date) &&
      normalizeText(issue.keyIssue) === normalizeText(record.keyIssue) &&
      normalizeText(issue.detail) === normalizeText(record.detail),
  );
  if (!exists) {
    allIssues = [record, ...allIssues];
  }
  populateFilters(allIssues);
  render();
}

function recordsContainIssue(records, values) {
  const keyIssue = normalizeText(values["Key Issue"]);
  const detail = normalizeText(values.Detail);
  const date = normalizeText(values.Date);
  return records.some((record) => {
    if (keyIssue && normalizeText(record.keyIssue) !== keyIssue) return false;
    if (detail && normalizeText(record.detail) !== detail) return false;
    if (date && normalizeText(record.date) !== date) return false;
    return Boolean(keyIssue || detail);
  });
}

function setNewIssueSaving(isSaving) {
  const form = document.querySelector(".new-issue-form");
  const button = form?.querySelector(".save-new-issue");
  const fields = form?.querySelectorAll("input, select, textarea, button") || [];
  if (button) {
    button.disabled = isSaving;
    button.textContent = isSaving ? "Saving..." : "Save to Sheet";
  }
  fields.forEach((field) => {
    if (field.classList?.contains("close-detail")) return;
    field.disabled = isSaving;
  });
}

async function ensureAuthToken() {
  const existing = window.localStorage?.getItem(AUTH_TOKEN_KEY);
  if (existing) {
    try {
      await callAppsScript({ action: "session", authToken: existing });
      return existing;
    } catch (error) {
      window.localStorage?.removeItem(AUTH_TOKEN_KEY);
    }
  }

  const username = window.prompt("Issue Tracker Account (not Google)");
  if (!username) throw new Error("Account is required.");
  const password = window.prompt("Issue Tracker Password");
  if (!password) throw new Error("Password is required.");
  const passwordHash = await hashCredential(username, password);
  const result = await callAppsScript({ action: "login", username, passwordHash });
  if (!result.ok || !result.token) {
    throw new Error(result.message || "Login failed.");
  }
  window.localStorage?.setItem(AUTH_TOKEN_KEY, result.token);
  setText("sync-status", result.role ? `${result.role} Synced` : "Synced");
  return result.token;
}

async function hashCredential(username, password) {
  const text = `${normalizeText(username).toLowerCase()}:${String(password || "")}`;
  const bytes = new TextEncoder().encode(text);
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function callAppsScript(params) {
  return new Promise((resolve, reject) => {
    const callbackName = `__juliaIssueWrite_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(GOOGLE_APPS_SCRIPT_URL);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Save request timed out."));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload?.ok) {
        reject(new Error(payload?.message || "Save failed."));
        return;
      }
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Unable to reach Google Apps Script."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function callAppsScriptPost(params) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    body.set(key, value);
  });

  await fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body,
  });

  await wait(1800);
  return { ok: true };
}

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2800);
}

function setBoardMessage(message) {
  const messageElement = document.getElementById("board-message");
  if (!messageElement) return;
  messageElement.textContent = message;
  messageElement.classList.toggle("is-hidden", !message);
}

function updateShowingLabel(records) {
  const years = [...new Set(records.map((record) => record.year))].sort((a, b) => b.localeCompare(a));
  setText("showing-label", years.length ? `Showing ${years.join(" + ")}` : "No matching issues");
}

function setSyncStatus(label, synced) {
  const sync = document.getElementById("sync-status");
  if (!sync) return;
  sync.textContent = label;
  sync.classList.toggle("is-synced", synced);
  sync.classList.toggle("is-error", !synced && label === "Sheet Error");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function bindEvents() {
  ["year-filter", "model-filter", "module-filter", "severity-filter", "date-from-filter", "date-to-filter", "keyword-search"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", render);
    document.getElementById(id)?.addEventListener("change", render);
  });
  document.getElementById("refresh-button")?.addEventListener("click", loadIssues);
  document.getElementById("top-refresh-button")?.addEventListener("click", loadIssues);
  document.getElementById("new-issue-button")?.addEventListener("click", openNewIssue);
  document.getElementById("detail-backdrop")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
  document.querySelectorAll(".summary-card").forEach((button) => {
    button.addEventListener("click", () => {
      summaryFilter = button.dataset.summary || "all";
      document.querySelectorAll(".summary-card").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
    });
  });
}

const JuliaIssueTracker = {
  analyzeRawIssue,
  changedIssueFields,
  deriveStatus,
  editableIssueValues,
  escapeHtml,
  filterIssues,
  formatPercent,
  googleTableToRows,
  mergeSheetResults,
  modelOptions,
  normalizeRows,
  sheetRowsConfirmIssueChanges,
  recordsContainIssue,
  renderIssueCard,
  renderDetailHtml,
  renderNewIssueHtml,
  newIssueValuesFromFormData,
  optimisticIssueRecordFromValues,
  summarizeIssues,
  summarizeEditLog,
  targetSheetNameForIssue,
  updateIssueRecordLocally,
  uniqueOptions,
};

if (typeof globalThis !== "undefined") {
  globalThis.JuliaIssueTracker = JuliaIssueTracker;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bindEvents();
  loadIssues();
}
