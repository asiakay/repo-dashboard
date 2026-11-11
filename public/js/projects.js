// ============================================================
// Projects tab — handoff cards for every project page/app.
// Loaded before app.js; uses its globals (writeHeaders, handleWriteResponse,
// escapeText) only at call time. Data: /api/projects (see docs/projects.md).
// ============================================================

let projects = [];
let projectsError = null;
let projectsFilter = "all";

const PROJECT_STATUS_LABELS = { live: "Live", draft: "Draft", paused: "Paused", archived: "Archived" };

// Field order on the card and in the editor. `long` fields get a textarea.
const PROJECT_FIELDS = [
  { key: "name",           label: "Name", required: true },
  { key: "hook",           label: "Hook — one line on why it matters" },
  { key: "summary",        label: "One sentence — what it is and who it's for", long: true },
  { key: "status",         label: "Status", select: Object.keys(PROJECT_STATUS_LABELS) },
  { key: "front_end_url",  label: "Front end — live page URL" },
  { key: "front_end_host", label: "Front end host (e.g. Claude artifact, Cloudflare Pages)" },
  { key: "back_end_type",  label: "Back end (e.g. Tally form, D1, none)" },
  { key: "back_end_url",   label: "Back end — where data lands" },
  { key: "edit_front_end", label: "How to edit the front end", long: true },
  { key: "edit_back_end",  label: "How to edit the back end", long: true },
  { key: "repo_name",      label: "GitHub repo" },
  { key: "handoff_notes",  label: "Handoff notes — what to know before building on it", long: true },
  { key: "value_note",     label: "Value — portfolio, sellable or community; price if any", long: true },
  { key: "tags",           label: "Tags (comma-separated)" },
];

function escapeAttr(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeHref(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch { return null; }
}

// Renders a value that may be a URL (as a link) or plain instructions (as text).
function linkOrText(value) {
  if (!value) return "";
  const href = safeHref(value);
  if (href) {
    const label = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeText(label)}</a>`;
  }
  return escapeText(value);
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    projects = await res.json();
    projectsError = null;
  } catch (err) {
    console.warn("Could not load projects:", err);
    projects = [];
    projectsError = err.message;
  }
}

function projectRow(label, value) {
  if (!value) return "";
  return `<div class="project-row"><dt>${escapeText(label)}</dt><dd>${value}</dd></div>`;
}

function renderProjectCard(p) {
  const status = PROJECT_STATUS_LABELS[p.status] ? p.status : "draft";
  const repoHref = p.repo_name ? `https://github.com/asiakay/${encodeURIComponent(p.repo_name)}` : null;
  const tags = (p.tags || "").split(",").map(t => t.trim()).filter(Boolean);
  const missing = ["summary", "front_end_url", "edit_front_end", "handoff_notes"].filter(k => !p[k]);

  return `<article class="project-card project-status-${status}">
    <header class="project-card-header">
      <div>
        <h3 class="project-name">${escapeText(p.name)}</h3>
        ${p.hook ? `<p class="project-hook">${escapeText(p.hook)}</p>` : ""}
      </div>
      <span class="project-badge project-badge-${status}">${PROJECT_STATUS_LABELS[status]}</span>
    </header>
    ${p.summary ? `<p class="project-summary">${escapeText(p.summary)}</p>` : ""}
    <dl class="project-rows">
      ${projectRow("Front end", [linkOrText(p.front_end_url), p.front_end_host ? `<span class="project-muted">${escapeText(p.front_end_host)}</span>` : ""].filter(Boolean).join(" · "))}
      ${projectRow("Back end", [p.back_end_type ? escapeText(p.back_end_type) : "", linkOrText(p.back_end_url)].filter(Boolean).join(" · "))}
      ${projectRow("Edit page", linkOrText(p.edit_front_end))}
      ${projectRow("Edit back end", linkOrText(p.edit_back_end))}
      ${projectRow("Repo", repoHref ? `<a href="${escapeAttr(repoHref)}" target="_blank" rel="noopener noreferrer">${escapeText(p.repo_name)}</a>` : "")}
      ${projectRow("Handoff", p.handoff_notes ? escapeText(p.handoff_notes) : "")}
      ${projectRow("Value", p.value_note ? escapeText(p.value_note) : "")}
    </dl>
    ${tags.length ? `<div class="project-tags">${tags.map(t => `<span class="project-tag">${escapeText(t)}</span>`).join("")}</div>` : ""}
    <footer class="project-card-footer">
      ${missing.length ? `<span class="project-missing" title="Fill these in so someone else can pick it up">Missing: ${missing.map(m => m.replace(/_/g, " ")).join(", ")}</span>` : `<span class="project-complete">Ready to hand off</span>`}
      <button class="btn-ghost btn-sm" type="button" onclick="openProjectEditor(${Number(p.id)})">Edit</button>
    </footer>
  </article>`;
}

function renderProjects() {
  const container = document.getElementById("projects-list");
  if (!container) return;

  if (projectsError) {
    container.innerHTML = `<div class="empty-state">Couldn't load projects (${escapeText(projectsError)}).
      <button class="btn-ghost btn-sm" type="button" onclick="loadProjects().then(renderProjects)">Retry</button></div>`;
    return;
  }

  document.querySelectorAll(".project-filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === projectsFilter);
    b.setAttribute("aria-pressed", b.dataset.filter === projectsFilter ? "true" : "false");
  });

  const shown = projectsFilter === "all" ? projects : projects.filter(p => p.status === projectsFilter);
  const count = document.getElementById("projects-count");
  if (count) count.textContent = `${projects.length} project${projects.length !== 1 ? "s" : ""}`;

  if (!shown.length) {
    container.innerHTML = `<div class="empty-state">${projects.length ? "No projects with this status." :
      "No project cards yet. Add one here, or ask Claude to log a page with the upsert_project tool."}</div>`;
    return;
  }
  container.innerHTML = `<div class="project-grid">${shown.map(renderProjectCard).join("")}</div>`;
}

function setProjectsFilter(filter) {
  projectsFilter = filter;
  renderProjects();
}

function openProjectEditor(id) {
  const dialog = document.getElementById("project-editor");
  if (!dialog) return;
  const p = id ? projects.find(x => x.id === id) : null;
  if (id && !p) return;
  const data = p || { status: "draft" };

  document.getElementById("project-editor-title").textContent = p ? `Edit ${p.name}` : "New project card";
  const body = document.getElementById("project-editor-fields");
  body.innerHTML = PROJECT_FIELDS.map(f => {
    const val = data[f.key] == null ? "" : data[f.key];
    const id_ = `pe-${f.key}`;
    let input;
    if (f.select) {
      input = `<select id="${id_}" name="${f.key}">${f.select.map(o =>
        `<option value="${o}" ${o === val ? "selected" : ""}>${PROJECT_STATUS_LABELS[o]}</option>`).join("")}</select>`;
    } else if (f.long) {
      input = `<textarea id="${id_}" name="${f.key}" rows="2">${escapeText(val)}</textarea>`;
    } else {
      input = `<input id="${id_}" name="${f.key}" type="text" value="${escapeAttr(val)}" ${f.required ? "required" : ""} />`;
    }
    return `<div class="control ${f.long ? "project-field-wide" : ""}"><label for="${id_}">${escapeText(f.label)}</label>${input}</div>`;
  }).join("");

  const del = document.getElementById("project-editor-delete");
  del.classList.toggle("hidden", !p);
  dialog.dataset.projectId = p ? String(p.id) : "";
  document.getElementById("project-editor-status").textContent = "";
  dialog.showModal();
  document.getElementById("pe-name").focus();
}

async function saveProject(event) {
  event.preventDefault();
  const dialog = document.getElementById("project-editor");
  const statusEl = document.getElementById("project-editor-status");
  const id = dialog.dataset.projectId ? Number(dialog.dataset.projectId) : null;

  const payload = {};
  PROJECT_FIELDS.forEach(f => {
    const el = document.getElementById(`pe-${f.key}`);
    payload[f.key] = el ? el.value.trim() : "";
  });
  if (!payload.name) { statusEl.textContent = "Name is required."; return; }
  // Empty strings clear a field on update; the server stores them as NULL.

  const doSave = async () => {
    const res = await fetch(id ? `/api/projects/${id}` : "/api/projects", {
      method: id ? "PUT" : "POST",
      headers: writeHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.status === 400 || res.status === 409) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return handleWriteResponse(res, doSave);
  };

  statusEl.textContent = "Saving…";
  try {
    const saved = await doSave();
    const idx = projects.findIndex(p => p.id === saved.id);
    if (idx === -1) projects.unshift(saved); else projects[idx] = saved;
    dialog.close();
    renderProjects();
  } catch (err) {
    statusEl.textContent = "Couldn't save: " + err.message;
  }
}

async function deleteProject() {
  const dialog = document.getElementById("project-editor");
  const id = Number(dialog.dataset.projectId);
  const p = projects.find(x => x.id === id);
  if (!p || !confirm(`Delete the card for “${p.name}”? This can't be undone.`)) return;

  const doDelete = async () => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE", headers: writeHeaders() });
    return handleWriteResponse(res, doDelete);
  };
  try {
    await doDelete();
    projects = projects.filter(x => x.id !== id);
    dialog.close();
    renderProjects();
  } catch (err) {
    document.getElementById("project-editor-status").textContent = "Couldn't delete: " + err.message;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("project-editor-form");
  if (form) form.addEventListener("submit", saveProject);
  const cancel = document.getElementById("project-editor-cancel");
  if (cancel) cancel.addEventListener("click", () => document.getElementById("project-editor").close());
  const del = document.getElementById("project-editor-delete");
  if (del) del.addEventListener("click", deleteProject);
  const add = document.getElementById("project-add-btn");
  if (add) add.addEventListener("click", () => openProjectEditor(null));
  document.querySelectorAll(".project-filter-btn").forEach(b =>
    b.addEventListener("click", () => setProjectsFilter(b.dataset.filter)));
});
