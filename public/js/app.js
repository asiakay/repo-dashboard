// ============================================================
// Write auth — token stored in localStorage, prompted on 401
// ============================================================
function writeHeaders() {
  const token = localStorage.getItem("writeToken");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function handleWriteResponse(res, retryFn) {
  if (res.status === 401) {
    const token = prompt(
      "A write token is required.\n" +
      "Enter your WRITE_TOKEN (it will be saved in this browser):"
    );
    if (token) {
      localStorage.setItem("writeToken", token.trim());
      return retryFn();
    }
    throw new Error("Write token required — request cancelled.");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let allRepos = [];
let filteredRepos = [];
let workItems = [];
let priorityData = { items: [], bottlenecks: [] };
let okrStats = null;
let workItemsError = null;
let priorityError = null;
let reposError = null;
let okrStatsError = null;

// DOM refs — repos view
const searchInput = document.getElementById("search");
const languageFilter = document.getElementById("language-filter");
const healthFilter = document.getElementById("health-filter");
const sortBy = document.getElementById("sort-by");
const repoList = document.getElementById("repo-list");
const summaryText = document.getElementById("summary-text");
const dataFreshness = document.getElementById("data-freshness");

// Stats pills
const statTotal = document.getElementById("stat-total");
const statGreen = document.getElementById("stat-green");
const statYellow = document.getElementById("stat-yellow");
const statRed = document.getElementById("stat-red");

// Clickable stat pill filtering
const pillMeta = [
  { pill: document.getElementById("pill-total"), health: "" },
  { pill: document.getElementById("pill-green"), health: "green" },
  { pill: document.getElementById("pill-yellow"), health: "yellow" },
  { pill: document.getElementById("pill-red"), health: "red" },
];

pillMeta.forEach(({ pill, health }) => {
  const activate = () => {
    switchTab("repos");
    const current = healthFilter.value;
    healthFilter.value = current === health ? "" : health;
    updateActivePill();
    applyFilters();
  };
  pill.addEventListener("click", activate);
  pill.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
});

function updateActivePill() {
  const active = healthFilter.value;
  pillMeta.forEach(({ pill, health }) => {
    pill.classList.toggle("active", health === active);
  });
}

// ============================================================
// Tab switching
// ============================================================
const TABS = ["repos", "active-work", "agent-tasks", "priority", "okr-progress"];

function switchTab(tabId) {
  TABS.forEach(id => {
    const view = document.getElementById(`view-${id}`);
    if (view) view.classList.toggle("hidden", id !== tabId);
  });
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (tabId === "active-work") renderActiveWork();
  if (tabId === "agent-tasks") renderAgentTasks();
  if (tabId === "priority") renderPriority();
  if (tabId === "okr-progress") renderOkrProgress();
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelector(".tab-nav-inner").addEventListener("keydown", e => {
  const tabs = [...document.querySelectorAll(".tab-btn")];
  const idx = tabs.indexOf(document.activeElement);
  if (idx === -1) return;
  if (e.key === "ArrowRight") { tabs[(idx + 1) % tabs.length].focus(); e.preventDefault(); }
  if (e.key === "ArrowLeft")  { tabs[(idx - 1 + tabs.length) % tabs.length].focus(); e.preventDefault(); }
  if (e.key === "Home") { tabs[0].focus(); e.preventDefault(); }
  if (e.key === "End")  { tabs[tabs.length - 1].focus(); e.preventDefault(); }
});

// ============================================================
// Data loading
// ============================================================
async function loadRepos() {
  try {
    let data;
    try {
      const res = await fetch("/api/repos");
      data = await res.json();
    } catch {
      const res = await fetch("/data/repos.json");
      data = await res.json();
    }

    if (data && data.error) {
      reposError = data.message || "GitHub API error";
      summaryText.textContent = "";
      renderRepos();
      return;
    }

    if (Array.isArray(data)) {
      allRepos = data;
    } else if (data && Array.isArray(data.repos)) {
      allRepos = data.repos;
      if (data.generated_at) showFreshness(data.generated_at);
    } else {
      reposError = "No repo data found";
      summaryText.textContent = "";
      renderRepos();
      return;
    }

    reposError = null;
    filteredRepos = [...allRepos];
    populateLanguageFilter();
    updateStats();
    applySorting();
    renderRepos();
    summaryText.textContent = `Showing ${filteredRepos.length} repositories`;

  } catch (err) {
    console.error("Error loading repos:", err);
    reposError = err.message;
    summaryText.textContent = "";
    renderRepos();
  }
}

async function loadWorkItems() {
  try {
    const res = await fetch("/api/work-items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    workItems = await res.json();
    workItemsError = null;
  } catch (err) {
    console.warn("Could not load work items:", err);
    workItems = [];
    workItemsError = err.message;
  }
}

async function loadPriorityData() {
  try {
    const res = await fetch("/api/priority");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    priorityData = await res.json();
    priorityError = null;
  } catch (err) {
    console.warn("Could not load priority data:", err);
    priorityData = { items: [], bottlenecks: [] };
    priorityError = err.message;
  }
}

async function retryRepos() {
  reposError = null;
  summaryText.textContent = "Loading…";
  repoList.innerHTML = "";
  await loadRepos();
  renderRepos();
}

async function retryWorkItems() {
  workItemsError = null;
  await loadWorkItems();
  renderActiveWork();
  renderAgentTasks();
  renderRepos();
}

async function retryPriority() {
  priorityError = null;
  await loadPriorityData();
  renderPriority();
}

async function loadOkrStats() {
  try {
    const res = await fetch("/api/okr-stats");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    okrStats = await res.json();
    okrStatsError = null;
  } catch (err) {
    console.warn("Could not load OKR stats:", err);
    okrStats = null;
    okrStatsError = err.message;
  }
}

async function retryOkrStats() {
  okrStatsError = null;
  await loadOkrStats();
  renderOkrProgress();
}

function showFreshness(isoString) {
  const mins = Math.round((Date.now() - new Date(isoString)) / 60000);
  const label = mins < 2
    ? "Refreshed just now"
    : mins < 60
    ? `Refreshed ${mins}m ago`
    : `Refreshed ${Math.round(mins / 60)}h ago`;
  dataFreshness.textContent = " · " + label;
}

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ============================================================
// Repos view
// ============================================================
function populateLanguageFilter() {
  const languages = [...new Set(allRepos.map(r => r.language).filter(Boolean))];
  languages.sort();
  languages.forEach(lang => {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    languageFilter.appendChild(opt);
  });
}

function updateStats() {
  statTotal.textContent = allRepos.length;
  statGreen.textContent = allRepos.filter(r => r.health === "green").length;
  statYellow.textContent = allRepos.filter(r => r.health === "yellow").length;
  statRed.textContent = allRepos.filter(r => r.health === "red").length;
}

function applyFilters() {
  const q = searchInput.value.toLowerCase();
  const lang = languageFilter.value;
  const health = healthFilter.value;

  filteredRepos = allRepos.filter(repo => {
    const matchesSearch =
      repo.name.toLowerCase().includes(q) ||
      (repo.description || "").toLowerCase().includes(q) ||
      (repo.topics || []).some(t => t.toLowerCase().includes(q));
    const matchesLanguage = lang ? repo.language === lang : true;
    const matchesHealth = health ? repo.health === health : true;
    return matchesSearch && matchesLanguage && matchesHealth;
  });

  applySorting();
  summaryText.textContent = `Showing ${filteredRepos.length} repositories`;
  renderRepos();
}

function applySorting() {
  const val = sortBy.value;
  filteredRepos.sort((a, b) => {
    switch (val) {
      case "updated_desc": return new Date(b.updated_at) - new Date(a.updated_at);
      case "updated_asc":  return new Date(a.updated_at) - new Date(b.updated_at);
      case "name_asc":     return a.name.localeCompare(b.name);
      case "name_desc":    return b.name.localeCompare(a.name);
      case "issues_desc":  return (b.open_issues || 0) - (a.open_issues || 0);
      case "stars_desc":   return (b.stars || 0) - (a.stars || 0);
      default: return 0;
    }
  });
}

function escapeText(str) {
  const d = document.createElement("div");
  d.appendChild(document.createTextNode(str || ""));
  return d.innerHTML;
}

const WORK_STATUS_LABELS = {
  not_started: "Not started",
  in_progress:  "In progress",
  blocked:      "Blocked",
  done:         "Done",
};

function errorBanner(message, retryFn) {
  return `<div class="load-error" role="alert">
    <span class="load-error-msg">⚠ ${escapeText(message)}</span>
    <button class="btn-ghost btn-sm" onclick="${escapeText(retryFn)}()">Retry</button>
  </div>`;
}

function renderRepos() {
  repoList.innerHTML = "";

  if (reposError) {
    repoList.insertAdjacentHTML("beforeend", errorBanner(`Failed to load repositories — ${reposError}`, "retryRepos"));
    return;
  }

  if (!filteredRepos.length) {
    const p = document.createElement("p");
    p.style.cssText = "color:var(--text-muted);padding:10px;";
    p.textContent = "No repositories found.";
    repoList.appendChild(p);
    return;
  }

  filteredRepos.forEach(repo => {
    const updated = new Date(repo.updated_at).toLocaleDateString();
    const issues = repo.open_issues || 0;
    const stars = repo.stars || 0;
    const forks = repo.forks || 0;
    const topics = (repo.topics || []).slice(0, 5);

    const issuesBadge = issues > 0
      ? `<a href="${escapeText(repo.url)}/issues" target="_blank" rel="noopener noreferrer" class="badge badge-issues">${issues} issue${issues !== 1 ? "s" : ""}</a>`
      : "";

    const langBadge = repo.language
      ? `<span class="badge badge-language">${escapeText(repo.language)}</span>`
      : "";

    const homepageBadge = repo.homepage
      ? `<a href="${escapeText(repo.homepage)}" target="_blank" rel="noopener noreferrer" class="badge badge-homepage" aria-label="Visit live site for ${escapeText(repo.name)}">↗ site</a>`
      : "";

    const topicsHtml = topics.length
      ? `<div class="repo-topics">${topics.map(t => `<span class="badge badge-topic">${escapeText(t)}</span>`).join("")}</div>`
      : "";

    const starsForks = (stars > 0 || forks > 0)
      ? `<span class="meta-stars" aria-label="${stars} stars">★ ${stars}</span><span class="meta-forks" aria-label="${forks} forks">⑂ ${forks}</span>`
      : "";

    // Work status badge — find the most relevant open work item for this repo
    const wi = workItems.find(w => w.repo_name === repo.name && w.status !== "done");
    const workBadge = wi
      ? `<span class="badge badge-work badge-work-${wi.status}" title="${escapeText(wi.task_description)}">${escapeText(WORK_STATUS_LABELS[wi.status] || wi.status)}</span>`
      : "";

    const card = `
      <div class="repo-card">
        <div class="repo-header">
          <div class="repo-name">
            <a href="${escapeText(repo.url)}" target="_blank" rel="noopener noreferrer">${escapeText(repo.name)}</a>
          </div>
          <div class="repo-badges">
            <span class="badge badge-health-${repo.health}">
              <span class="badge-dot" aria-hidden="true"></span>${repo.health.toUpperCase()}
            </span>
            ${workBadge}
            ${homepageBadge}
            ${langBadge}
            ${issuesBadge}
          </div>
        </div>

        <p class="repo-description">${escapeText(repo.description || "No description.")}</p>

        ${topicsHtml}

        <div class="repo-meta">
          <span>Updated: ${updated}</span>
          <span>Branch: ${escapeText(repo.default_branch || "main")}</span>
          ${starsForks}
        </div>
      </div>
    `;

    repoList.insertAdjacentHTML("beforeend", card);
  });
}

// ============================================================
// Active Work view
// ============================================================
const STATUS_ORDER = ["in_progress", "blocked", "not_started"];
const STATUS_SECTION_LABELS = {
  in_progress: "In Progress",
  blocked:     "Blocked",
  not_started: "Not Started",
};

function depHasOpenWork(dependsOnRepo) {
  return workItems.some(w => w.repo_name === dependsOnRepo && w.status !== "done");
}

function renderActiveWork() {
  const container = document.getElementById("active-work-list");

  if (workItemsError) {
    container.innerHTML = errorBanner(`Failed to load work items — ${workItemsError}`, "retryWorkItems");
    return;
  }

  const showDone = document.getElementById("toggle-show-done")?.checked;
  const visibleItems = showDone ? workItems : workItems.filter(w => w.status !== "done");

  if (!visibleItems.length) {
    container.innerHTML = `
      <div class="work-toggle-row">
        <label class="toggle-label">
          <input type="checkbox" id="toggle-show-done" ${showDone ? "checked" : ""} />
          Show completed
        </label>
      </div>
      <p class="empty-state">Nothing active right now. All clear!</p>`;
    document.getElementById("toggle-show-done").addEventListener("change", renderActiveWork);
    return;
  }

  let html = `
    <div class="work-toggle-row">
      <label class="toggle-label">
        <input type="checkbox" id="toggle-show-done" ${showDone ? "checked" : ""} />
        Show completed
      </label>
    </div>`;

  const allStatuses = showDone ? [...STATUS_ORDER, "done"] : STATUS_ORDER;
  allStatuses.forEach(status => {
    const items = visibleItems.filter(w => w.status === status);
    if (!items.length) return;

    const sectionLabel = STATUS_SECTION_LABELS[status] || WORK_STATUS_LABELS[status] || status;
    html += `<div class="work-group">
      <h3 class="work-group-label">${sectionLabel} <span class="work-group-count">${items.length}</span></h3>`;

    items.forEach(item => {
      const depWarning = item.depends_on_repo && depHasOpenWork(item.depends_on_repo)
        ? `<div class="dep-warning">⚠ <strong>${escapeText(item.repo_name)}</strong> depends on <strong>${escapeText(item.depends_on_repo)}</strong>, which has unfinished work.</div>`
        : "";

      const startedAgo = timeAgo(item.started_at);
      const timeSpan = startedAgo
        ? `<span class="work-time" title="${escapeText(item.started_at)}">Started ${startedAgo}</span>`
        : "";

      const depSpan = item.depends_on_repo
        ? `<span class="work-dep">→ needs ${escapeText(item.depends_on_repo)}</span>`
        : "";

      const notesDiv = item.notes
        ? `<div class="work-notes-inline">${escapeText(item.notes)}</div>`
        : "";

      html += `
        <div class="work-row" data-id="${item.id}">
          ${depWarning}
          <div class="work-card-top">
            <span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span>
            <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
            <span class="work-task">${escapeText(item.task_description)}</span>
          </div>
          <div class="work-card-meta">
            <span class="work-assigned badge-assigned-${item.assigned_to}">${escapeText(item.assigned_to)}</span>
            ${depSpan}
            ${timeSpan}
            <button class="btn-ghost btn-sm" onclick="openEditForm(${item.id})">Edit</button>
          </div>
          ${notesDiv}
          <div id="edit-form-${item.id}" class="work-form work-inline-form hidden"></div>
        </div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
  document.getElementById("toggle-show-done").addEventListener("change", renderActiveWork);
}

function openEditForm(id) {
  const item = workItems.find(w => w.id === id);
  if (!item) return;

  // Close any other open forms
  document.querySelectorAll(".work-inline-form").forEach(f => {
    if (f.id !== `edit-form-${id}`) f.classList.add("hidden");
  });

  const formEl = document.getElementById(`edit-form-${id}`);
  if (!formEl.classList.contains("hidden")) {
    formEl.classList.add("hidden");
    return;
  }

  formEl.innerHTML = `
    <div class="work-form-grid">
      <div class="control">
        <label>Status</label>
        <select id="ef-status-${id}">
          <option value="not_started" ${item.status === "not_started" ? "selected" : ""}>Not started</option>
          <option value="in_progress" ${item.status === "in_progress" ? "selected" : ""}>In progress</option>
          <option value="blocked" ${item.status === "blocked" ? "selected" : ""}>Blocked</option>
          <option value="done" ${item.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </div>
      <div class="control">
        <label>Assigned to</label>
        <select id="ef-assigned-${id}">
          <option value="agent" ${item.assigned_to === "agent" ? "selected" : ""}>Agent</option>
          <option value="asia" ${item.assigned_to === "asia" ? "selected" : ""}>Asia</option>
        </select>
      </div>
      <div class="control">
        <label>Notes</label>
        <input id="ef-notes-${id}" type="text" value="${escapeText(item.notes || "")}" placeholder="One-line summary..." />
      </div>
    </div>
    <div class="work-form-actions">
      <button class="btn-primary" onclick="saveEdit(${id})">Save</button>
      <button class="btn-ghost" onclick="document.getElementById('edit-form-${id}').classList.add('hidden')">Cancel</button>
    </div>`;

  formEl.classList.remove("hidden");
}

async function saveEdit(id) {
  const status = document.getElementById(`ef-status-${id}`).value;
  const assigned_to = document.getElementById(`ef-assigned-${id}`).value;
  const notes = document.getElementById(`ef-notes-${id}`).value;

  const started_at = status === "in_progress" && !workItems.find(w => w.id === id)?.started_at
    ? new Date().toISOString()
    : undefined;
  const completed_at = status === "done"
    ? new Date().toISOString()
    : undefined;

  const body = { status, assigned_to, notes };
  if (started_at !== undefined) body.started_at = started_at;
  if (completed_at !== undefined) body.completed_at = completed_at;

  const doSave = async () => {
    const res = await fetch(`/api/work-items/${id}`, {
      method: "PUT",
      headers: writeHeaders(),
      body: JSON.stringify(body),
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    const updated = await doSave();
    const idx = workItems.findIndex(w => w.id === id);
    if (idx !== -1) workItems[idx] = updated;
    renderActiveWork();
    renderRepos();
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

// ============================================================
// Agent Tasks view
// ============================================================
function renderAgentTasks() {
  const container = document.getElementById("agent-tasks-list");

  if (workItemsError) {
    container.innerHTML = errorBanner(`Failed to load agent tasks — ${workItemsError}`, "retryWorkItems");
    return;
  }

  const agentItems = workItems
    .filter(w => w.assigned_to === "agent")
    .sort((a, b) => {
      if (a.started_at && b.started_at) return new Date(b.started_at) - new Date(a.started_at);
      if (a.started_at) return -1;
      if (b.started_at) return 1;
      return 0;
    });

  if (!agentItems.length) {
    container.innerHTML = `<p class="empty-state">No agent tasks found.</p>`;
    return;
  }

  // Table (desktop)
  const rows = agentItems.map(item => {
    const startedAgo = timeAgo(item.started_at);
    const completedAgo = timeAgo(item.completed_at);
    const startedFull = item.started_at ? new Date(item.started_at).toLocaleDateString() : null;
    const completedFull = item.completed_at ? new Date(item.completed_at).toLocaleDateString() : null;
    const sourceBadge = item.source_type === "github_issue"
      ? `<span class="badge badge-source-auto">auto</span>`
      : `<span class="badge badge-source-manual">manual</span>`;
    const issueLink = item.source_url
      ? `<a href="${escapeText(item.source_url)}" target="_blank" rel="noopener noreferrer" class="badge badge-issue-link" title="View GitHub issue">↗ issue</a>`
      : "";
    return `
    <tr>
      <td><a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer">${escapeText(item.repo_name)}</a></td>
      <td>${escapeText(item.task_description)}</td>
      <td><span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span></td>
      <td>${sourceBadge}${issueLink}</td>
      <td ${startedFull ? `title="${escapeText(startedFull)}"` : ""}>${startedAgo || "—"}</td>
      <td ${completedFull ? `title="${escapeText(completedFull)}"` : ""}>${completedAgo || "—"}</td>
      <td class="notes-cell">${escapeText(item.notes || "")}</td>
    </tr>`;
  }).join("");

  // Cards (mobile)
  const cards = agentItems.map(item => {
    const startedAgo = timeAgo(item.started_at);
    const completedAgo = timeAgo(item.completed_at);
    const notesHtml = item.notes
      ? `<p class="agent-card-notes">${escapeText(item.notes)}</p>`
      : "";
    const metaParts = [
      startedAgo ? `Started ${startedAgo}` : null,
      completedAgo ? `Done ${completedAgo}` : null,
    ].filter(Boolean);
    const sourceBadge = item.source_type === "github_issue"
      ? `<span class="badge badge-source-auto">auto</span>`
      : `<span class="badge badge-source-manual">manual</span>`;
    const issueLink = item.source_url
      ? `<a href="${escapeText(item.source_url)}" target="_blank" rel="noopener noreferrer" class="badge badge-issue-link">↗ issue</a>`
      : "";
    return `
    <div class="agent-card">
      <div class="agent-card-header">
        <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer">${escapeText(item.repo_name)}</a>
        <div class="agent-card-badges">
          <span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span>
          ${sourceBadge}${issueLink}
        </div>
      </div>
      <p class="agent-card-task">${escapeText(item.task_description)}</p>
      ${metaParts.length ? `<div class="agent-card-meta">${metaParts.map(p => `<span>${p}</span>`).join("")}</div>` : ""}
      ${notesHtml}
    </div>`;
  }).join("");

  container.innerHTML = `
    <div class="agent-table-wrap">
      <div class="table-scroll">
        <table class="work-table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Task</th>
              <th>Status</th>
              <th>Source</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="agent-cards">${cards}</div>`;
}

// ============================================================
// Priority view
// ============================================================
function renderPriority() {
  const container = document.getElementById("priority-list");

  if (priorityError) {
    container.innerHTML = errorBanner(`Failed to load priority data — ${priorityError}`, "retryPriority");
    return;
  }

  const { items, bottlenecks } = priorityData;

  let html = "";

  // Bottlenecks panel — signals due within 7 days with no in-progress work in affected repos
  if (bottlenecks && bottlenecks.length > 0) {
    html += `<div class="bottleneck-panel" role="alert" aria-label="Priority bottlenecks">
      <div class="bottleneck-header">
        <span aria-hidden="true">⚠</span>
        <strong>Bottlenecks — Urgent deadlines with no in-progress work</strong>
        <span class="bottleneck-count">${bottlenecks.length}</span>
      </div>
      <ul class="bottleneck-list">`;

    for (const b of bottlenecks) {
      const daysLabel = b.days_remaining <= 0
        ? `<strong class="text-urgent">OVERDUE</strong>`
        : `<strong class="${b.days_remaining <= 3 ? "text-urgent" : ""}">${b.days_remaining}d remaining</strong>`;
      html += `<li class="bottleneck-item">
        <span class="bottleneck-title">${escapeText(b.title)}</span>
        <span class="bottleneck-meta">
          · due ${escapeText(b.due_date)} · ${daysLabel}
          · from <a href="https://github.com/asiakay/${escapeText(b.source_repo)}" target="_blank" rel="noopener noreferrer">${escapeText(b.source_repo)}</a>
        </span>
        <span class="bottleneck-repos">affects: ${b.affects_repos.map(r => escapeText(r)).join(", ")}</span>
      </li>`;
    }
    html += `</ul></div>`;
  }

  if (!items || !items.length) {
    html += `<p class="empty-state">No active work items. All done!</p>`;
    container.innerHTML = html;
    return;
  }

  // Table (desktop)
  const rows = items.map(item => {
    const tierClass = `badge-tier-${item.tier_num}`;
    let drivingHtml;
    if (item.driving_signal) {
      const d = item.driving_signal;
      const daysLabel = d.days_remaining <= 0
        ? `<span class="text-urgent">OVERDUE</span>`
        : `${d.days_remaining}d`;
      drivingHtml = `<div class="signal-title">${escapeText(d.title)}</div>
        <div class="signal-meta">
          ${escapeText(d.due_date)} · ${daysLabel} ·
          <a href="https://github.com/asiakay/${escapeText(d.source_repo)}" target="_blank" rel="noopener noreferrer">${escapeText(d.source_repo)}</a>
          <span class="badge-domain badge-domain-${escapeText(d.domain)}">${escapeText(d.domain)}</span>
        </div>`;
    } else {
      drivingHtml = `<span class="no-signal-note">No external deadline pressure — manual priority only</span>`;
    }

    const overrideVal = item.manual_consequence_override != null ? String(item.manual_consequence_override) : "";
    return `<tr data-id="${item.id}">
      <td><span class="badge badge-tier ${tierClass}" title="${escapeText(item.tier_label)}">${item.tier_num}</span></td>
      <td><a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer">${escapeText(item.repo_name)}</a></td>
      <td>${escapeText(item.task_description)}</td>
      <td class="score-cell"><span class="impact-score">${item.impact_score}</span><span class="impact-max">/25</span></td>
      <td>${drivingHtml}</td>
      <td>
        <input type="number" class="override-input" min="1" max="5" value="${escapeText(overrideVal)}"
          placeholder="1–5" title="Override consequence severity (1–5). Clears when a deadline signal is linked."
          data-id="${item.id}" />
      </td>
    </tr>`;
  }).join("");

  // Mobile cards
  const cards = items.map(item => {
    let drivingHtml;
    if (item.driving_signal) {
      const d = item.driving_signal;
      const daysLabel = d.days_remaining <= 0 ? "OVERDUE" : `${d.days_remaining}d`;
      drivingHtml = `<div class="signal-title">${escapeText(d.title)}</div>
        <div class="signal-meta">${escapeText(d.due_date)} · ${daysLabel}</div>`;
    } else {
      drivingHtml = `<span class="no-signal-note">No deadline pressure</span>`;
    }
    return `<div class="work-row">
      <div class="work-card-top">
        <span class="badge badge-tier badge-tier-${item.tier_num}" title="${escapeText(item.tier_label)}">${item.tier_num}</span>
        <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
        <span class="work-task">${escapeText(item.task_description)}</span>
      </div>
      <div class="priority-card-meta">
        <span>Score: <strong>${item.impact_score}</strong>/25</span>
        ${drivingHtml}
      </div>
    </div>`;
  }).join("");

  html += `
    <div class="priority-table-wrap">
      <div class="table-scroll">
        <table class="work-table priority-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Repo</th>
              <th>Task</th>
              <th>Score</th>
              <th>Driving Deadline</th>
              <th title="Override consequence severity (1–5) when auto-detected value needs adjustment">Override</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="priority-cards">${cards}</div>`;

  container.innerHTML = html;

  // Wire up override inputs after DOM is written
  container.querySelectorAll(".override-input").forEach(input => {
    input.addEventListener("change", () => {
      saveOverride(parseInt(input.dataset.id, 10), input.value);
    });
  });
}

async function saveOverride(id, value) {
  const parsed = parseInt(value, 10);
  const override = (parsed >= 1 && parsed <= 5) ? parsed : null;
  const body = JSON.stringify({ manual_consequence_override: override });

  const doSave = async () => {
    const res = await fetch(`/api/work-items/${id}`, {
      method: "PUT",
      headers: writeHeaders(),
      body,
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    await doSave();
    await loadPriorityData();
    renderPriority();
  } catch (err) {
    console.error("Failed to save override:", err);
  }
}

// ============================================================
// Add work item form
// ============================================================
document.getElementById("btn-add-work-item").addEventListener("click", () => {
  document.getElementById("add-work-item-form").classList.toggle("hidden");
});

document.getElementById("btn-cancel-work-item").addEventListener("click", () => {
  document.getElementById("add-work-item-form").classList.add("hidden");
});

document.getElementById("btn-save-work-item").addEventListener("click", async () => {
  const repo_name = document.getElementById("wf-repo").value.trim();
  const task_description = document.getElementById("wf-task").value.trim();
  const status = document.getElementById("wf-status").value;
  const assigned_to = document.getElementById("wf-assigned").value;
  const depends_on_repo = document.getElementById("wf-depends").value.trim() || null;
  const notes = document.getElementById("wf-notes").value.trim() || null;

  if (!repo_name || !task_description) {
    alert("Repo name and task description are required.");
    return;
  }

  const body = { repo_name, task_description, status, assigned_to, depends_on_repo, notes };
  if (status === "in_progress") body.started_at = new Date().toISOString();
  const serialized = JSON.stringify(body);

  const doAdd = async () => {
    const res = await fetch("/api/work-items", {
      method: "POST",
      headers: writeHeaders(),
      body: serialized,
    });
    return handleWriteResponse(res, doAdd);
  };

  try {
    const newItem = await doAdd();
    workItems.push(newItem);

    // Reset form
    ["wf-repo", "wf-task", "wf-depends", "wf-notes"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("add-work-item-form").classList.add("hidden");

    renderActiveWork();
    renderRepos();
  } catch (err) {
    alert("Failed to add work item: " + err.message);
  }
});

// ============================================================
// Event listeners — repos view
// ============================================================
searchInput.addEventListener("input", applyFilters);
languageFilter.addEventListener("change", applyFilters);
healthFilter.addEventListener("change", () => {
  updateActivePill();
  applyFilters();
});
sortBy.addEventListener("change", () => {
  applySorting();
  renderRepos();
});

// ============================================================
// OKR Progress view
// ============================================================
const OKR_STATUS_BADGE = {
  "In Progress": "badge-work-in_progress",
  "Planned": "badge-work-not_started",
  "In Review": "badge-work-blocked",
  "Completed": "badge-work-done",
};

function renderOkrProgress() {
  const container = document.getElementById("okr-progress-list");

  if (okrStatsError) {
    container.innerHTML = errorBanner(`Failed to load OKR data — ${okrStatsError}`, "retryOkrStats");
    return;
  }

  if (!okrStats) {
    container.innerHTML = `<p class="empty-state">Loading OKR data…</p>`;
    return;
  }

  if (okrStats.migration_pending) {
    container.innerHTML = `
      <div class="load-error" role="alert">
        <span class="load-error-msg">OKR tables not found in the database.</span>
        <span class="load-error-msg" style="margin-top:6px">
          Go to <strong>GitHub → Actions → "Initialize OKR &amp; Task Tracker schema"</strong>
          and click <strong>Run workflow</strong>, then refresh this page.
        </span>
      </div>`;
    return;
  }

  const { okrs, today } = okrStats;

  if (!okrs || !okrs.length) {
    container.innerHTML = `<p class="empty-state">No OKRs found. Register OKRs using the MCP tools.</p>`;
    return;
  }

  const okrCards = okrs.map(okr => {
    const pct = okr.completion_pct || 0;
    const barColor = pct >= 80 ? "var(--success)" : pct >= 40 ? "var(--accent)" : "var(--danger)";
    const badgeClass = OKR_STATUS_BADGE[okr.status] || "badge-work-not_started";
    const targetDate = okr.target_date
      ? `<span class="okr-target-date">${escapeText(okr.target_date)}</span>`
      : "";
    const taskChips = okr.total_tasks > 0
      ? `<span class="okr-task-chip">${okr.done_tasks}/${okr.total_tasks} tasks done</span>`
      : `<span class="okr-task-chip okr-task-chip-empty">No tasks yet</span>`;

    return `
      <div class="okr-card">
        <div class="okr-card-header">
          <div class="okr-card-title">
            <span class="okr-id">${escapeText(okr.id)}</span>
            <span class="badge badge-work ${badgeClass}">${escapeText(okr.status || "Planned")}</span>
          </div>
          <div class="okr-card-meta">
            ${taskChips}
            ${targetDate}
          </div>
        </div>
        <div class="okr-objective">${escapeText(okr.objective)}</div>
        <div class="okr-key-result">${escapeText(okr.key_result)}</div>
        <div class="okr-bar-wrap">
          <div class="okr-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% complete">
            <div class="okr-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <span class="okr-bar-label">${pct}%</span>
        </div>
      </div>`;
  }).join("");

  const taskStatusClass = s => s === "Done" ? "done" : s === "In Progress" ? "in_progress" : "not_started";

  const todayTasks = today && today.tasks && today.tasks.length
    ? today.tasks.map(t => {
        const statusBadge = t.status
          ? `<span class="badge badge-work badge-work-${taskStatusClass(t.status)}">${escapeText(t.status)}</span>`
          : "";
        const timeSpent = t.time_spent
          ? `<span class="okr-task-time">${escapeText(t.time_spent)}</span>`
          : "";
        return `
          <div class="okr-today-row">
            <div class="okr-today-meta">
              <span class="okr-today-okr-id">${escapeText(t.okr_id)}</span>
              ${statusBadge}
              ${timeSpent}
            </div>
            <div class="okr-today-desc">${escapeText(t.description)}</div>
            ${t.notes ? `<div class="okr-today-notes">${escapeText(t.notes)}</div>` : ""}
          </div>`;
      }).join("")
    : `<p class="empty-state">No tasks logged today. Use <code>log_task</code> via MCP to add one.</p>`;

  const taskCount = (today && today.tasks) ? today.tasks.length : 0;

  container.innerHTML = `
    <div class="okr-grid">${okrCards}</div>
    <section class="okr-today-section">
      <h3 class="okr-today-title">Today's Log <span class="work-group-count">${taskCount}</span></h3>
      <div class="okr-today-list">${todayTasks}</div>
    </section>`;
}

// ============================================================
// Init
// ============================================================
async function init() {
  await Promise.all([loadRepos(), loadWorkItems(), loadPriorityData(), loadOkrStats()]);
  renderRepos(); // re-render repos with work items overlaid
}

init();
