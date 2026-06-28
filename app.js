const SPREADSHEET_ID = "1lCFXw1kRPyBNs2zUc9LMA063v1AHAbehxRMezyLW1FU";
const SHEET_NAMES = ["2026", "2025"];
const SHEET_LOAD_TIMEOUT_MS = 20000;
const SHEET_RETRY_DELAYS_MS = [900, 2200];

const STATUSES = [
  { key: "submit", label: "To Submit", className: "submit" },
  { key: "submitted", label: "Submitted", className: "submitted" },
  { key: "progress", label: "In Progress", className: "progress" },
  { key: "resolved", label: "Resolved", className: "resolved" },
  { key: "archived", label: "Archived", className: "archived" },
];

const STATUS_LABELS = new Map(STATUSES.map((status) => [status.key, status.label]));

let allIssues = [];
let summaryFilter = "all";
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
  return deriveStatusFromProgress(row["Issue Progress"]);
}

function deriveStatusFromProgress(value) {
  const progress = normalizeText(value).toLowerCase();
  if (!progress || progress === "new") return "submit";
  if (progress === "initial reply sent") return "submitted";
  if (progress === "discussion ongoing") return "progress";
  if (progress === "closed") return "resolved";
  if (progress === "archived") return "archived";
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
        if (header) raw[header] = normalizeText(row[cellIndex]);
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
        severity: readField(raw, row, normalizedHeaderMap, 13, ["Severity"]),
        userEmotion: readField(raw, row, normalizedHeaderMap, 14, ["User Emotion", "Emotion"]),
        needsReply: readField(raw, row, normalizedHeaderMap, 15, ["Needs Reply"]),
        responseDate: readField(raw, row, normalizedHeaderMap, 19, ["Response Date"]),
        issueProgress: readField(raw, row, normalizedHeaderMap, 20, ["Issue Progress"]),
        handler: readField(raw, row, normalizedHeaderMap, 21, ["Handler"]),
        communicationProgress: readField(raw, row, normalizedHeaderMap, 22, ["Communication Progress"]),
        issueNumber: readField(raw, row, normalizedHeaderMap, 24, ["Issue Number", "Issue #"]),
        tags: readField(raw, row, normalizedHeaderMap, 25, ["Tags"]),
      };

      record.status = deriveStatusFromProgress(record.issueProgress);
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
      const mappedValue = normalizeText(row[mappedIndex]);
      if (mappedValue) return mappedValue;
    }
  }

  return normalizeText(row[fallbackIndex]);
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
    if (isConcrete(filters.model, "All Models") && record.model !== filters.model) return false;
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

function formatPercent(count, total) {
  if (!total) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function escapeHtml(value) {
  return normalizeText(value).replace(/[&<>"']/g, (char) => {
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

function isConcrete(value, allLabel) {
  return value && value !== allLabel;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function loadSheet(sheetName, attempt = 0) {
  return loadSheetOnce(sheetName, attempt).catch((error) => {
    const delay = SHEET_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) throw error;
    return wait(delay).then(() => loadSheet(sheetName, attempt + 1));
  });
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
  renderSelect("model-filter", uniqueOptions(records, "model"), "All Models");
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
  const issueNumberDetail = record.issueNumber
    ? `<dd>${escapeHtml(record.issueNumber)}</dd>`
    : `<dd class="missing">Missing</dd>`;
  const title = record.keyIssue || "Key issue missing";

  return `
    <article class="issue-card feedback-card" role="button" tabindex="0" data-record-id="${escapeHtml(record.id)}" aria-label="Open issue detail">
      <div class="chips">
        ${record.module ? `<span>${escapeHtml(record.module)}</span>` : ""}
        ${record.severity ? `<span class="${severityClass}">${escapeHtml(record.severity)}</span>` : ""}
        ${record.userEmotion ? `<span>${escapeHtml(record.userEmotion)}</span>` : ""}
      </div>
      <h3>${escapeHtml(title)}</h3>
      ${issueNumber}
      <dl>
        <div><dt>Model</dt><dd>${escapeHtml(record.model || "-")}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(record.date || "-")}</dd></div>
        <div><dt>Handler</dt><dd>${escapeHtml(record.handler || "-")}</dd></div>
        <div><dt>Issue #</dt>${issueNumberDetail}</div>
      </dl>
      <div class="card-actions"><span>View detail</span></div>
    </article>
  `;
}

function renderDetailHtml(record) {
  const chips = [
    record.module ? `<span>${escapeHtml(record.module)}</span>` : "",
    record.severity ? `<span class="${record.severity.toLowerCase() === "high" ? "high" : ""}">${escapeHtml(record.severity)}</span>` : "",
    record.userEmotion ? `<span>${escapeHtml(record.userEmotion)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="detail-panel__header">
      <div>
        <div class="chips">${chips}</div>
        <p class="detail-kicker">${escapeHtml(record.model || "Issue")} · ${escapeHtml(STATUS_LABELS.get(record.status) || record.status)}</p>
        <h2>${escapeHtml(record.keyIssue || record.chinese || record.detail || "Issue detail")}</h2>
      </div>
      <button class="close-detail" type="button" aria-label="Close detail">×</button>
    </div>
    <dl class="detail-list">
      ${detailRow("Date", record.date)}
      ${detailRow("Source", record.source)}
      ${detailRow("Email", record.email)}
      ${detailRow("User ID", record.userId)}
      ${detailRow("Model", record.model)}
      ${detailRow("Country", record.country)}
      ${detailRow("Module", record.module)}
      ${detailRow("Issue Type", record.issueType)}
      ${detailRow("Severity", record.severity)}
      ${detailRow("User Emotion", record.userEmotion)}
      ${detailRow("Needs Reply", record.needsReply)}
      ${detailRow("Issue Progress", record.issueProgress)}
      ${detailRow("Handler", record.handler)}
      ${detailRow("Communication Progress", record.communicationProgress)}
      ${detailRow("Issue Number", record.issueNumber || "Missing")}
      ${detailRow("Tags", record.tags)}
      ${detailRow("Key Issue", record.keyIssue, "wide")}
      ${detailRow("Detail", record.detail, "wide")}
      ${detailRow("Chinese", record.chinese, "wide")}
    </dl>
  `;
}

function renderNewIssueHtml() {
  return `
    <div class="detail-panel__header">
      <div>
        <div class="chips"><span>Draft</span><span>Read-only</span></div>
        <p class="detail-kicker">New Issue</p>
        <h2>Create a new issue draft</h2>
      </div>
      <button class="close-detail" type="button" aria-label="Close detail">×</button>
    </div>
    <form class="new-issue-form">
      <label>Raw User Feedback<textarea rows="5" placeholder="Paste the user's original words..."></textarea></label>
      <div class="new-issue-grid">
        <label>Date<input type="date" /></label>
        <label>Model<input placeholder="HA2, HA1UV, HD1..." /></label>
        <label>Module<input placeholder="Firmware, CPS, Hardware..." /></label>
        <label>Severity<select><option>High</option><option>Medium</option><option>Low</option></select></label>
        <label>User Emotion<select><option>Confused</option><option>Dissatisfied</option><option>Urgent</option><option>Calm</option></select></label>
        <label>Issue Number<input placeholder="Generated after submission" /></label>
      </div>
      <p class="drawer-note">Save to Sheet is not connected yet. This panel is ready for the next write-back step.</p>
      <button type="button" class="disabled-action" disabled>Save to Sheet not connected</button>
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
}

function openNewIssue() {
  openDrawer(renderNewIssueHtml());
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
  deriveStatus,
  escapeHtml,
  filterIssues,
  formatPercent,
  googleTableToRows,
  mergeSheetResults,
  normalizeRows,
  renderIssueCard,
  renderDetailHtml,
  renderNewIssueHtml,
  summarizeIssues,
  uniqueOptions,
};

if (typeof globalThis !== "undefined") {
  globalThis.JuliaIssueTracker = JuliaIssueTracker;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bindEvents();
  loadIssues();
}
