let allRepos = [];
let filteredRepos = [];

// DOM refs
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
  pill.addEventListener("click", () => {
    const current = healthFilter.value;
    healthFilter.value = current === health ? "" : health;
    updateActivePill();
    applyFilters();
  });
});

function updateActivePill() {
  const active = healthFilter.value;
  pillMeta.forEach(({ pill, health }) => {
    pill.classList.toggle("active", health === active);
  });
}

async function loadRepos() {
  try {
    const res = await fetch("/data/repos.json");
    const data = await res.json();

    // Handle both the new envelope { generated_at, repos } and bare arrays
    if (Array.isArray(data)) {
      allRepos = data;
    } else {
      allRepos = data.repos || [];
      if (data.generated_at) {
        showFreshness(data.generated_at);
      }
    }

    filteredRepos = [...allRepos];

    populateLanguageFilter();
    updateStats();
    renderRepos();
    summaryText.textContent = `Showing ${filteredRepos.length} repositories`;

  } catch (err) {
    console.error("Error loading repos:", err);
    summaryText.textContent = "Failed to load repositories.";
  }
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

function renderRepos() {
  repoList.innerHTML = "";

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
      ? `<a href="${escapeText(repo.url)}/issues" target="_blank" class="badge badge-issues">${issues} issue${issues !== 1 ? "s" : ""}</a>`
      : "";

    const langBadge = repo.language
      ? `<span class="badge badge-language">${escapeText(repo.language)}</span>`
      : "";

    const topicsHtml = topics.length
      ? `<div class="repo-topics">${topics.map(t => `<span class="badge badge-topic">${escapeText(t)}</span>`).join("")}</div>`
      : "";

    const starsForks = (stars > 0 || forks > 0)
      ? `<span class="meta-stars">★ ${stars}</span><span class="meta-forks">⑂ ${forks}</span>`
      : "";

    const card = `
      <div class="repo-card">
        <div class="repo-header">
          <div class="repo-name">
            <a href="${escapeText(repo.url)}" target="_blank">${escapeText(repo.name)}</a>
          </div>
          <div class="repo-badges">
            <span class="badge badge-health-${repo.health}">
              <span class="badge-dot"></span>${repo.health.toUpperCase()}
            </span>
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

// Event listeners
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

loadRepos();
