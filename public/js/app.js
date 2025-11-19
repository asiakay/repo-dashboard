// JS placeholder
// Simple UI "API" for filtering/sorting repos.json

const state = {
  allRepos: [],
  filteredRepos: [],
  search: "",
  language: "",
  health: "",
  sortBy: "updated_desc",
};

document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("search");
  const languageSelect = document.getElementById("language-filter");
  const healthSelect = document.getElementById("health-filter");
  const sortSelect = document.getElementById("sort-by");

  searchInput.addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    applyFilters();
  });

  languageSelect.addEventListener("change", (e) => {
    state.language = e.target.value;
    applyFilters();
  });

  healthSelect.addEventListener("change", (e) => {
    state.health = e.target.value;
    applyFilters();
  });

  sortSelect.addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    applyFilters();
  });

  loadRepos();
});

async function loadRepos() {
  try {
    const res = await fetch("data/repos.json", {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!res.ok) {
      throw new Error("Failed to load repos.json");
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error("Expected repos.json to be an array, got:", data);
      document.getElementById("summary-text").textContent =
        "Error: repos.json is not in the expected format.";
      return;
    }

    state.allRepos = data;
    buildLanguageFilterOptions(data);
    applyFilters();
  } catch (err) {
    console.error(err);
    document.getElementById("summary-text").textContent =
      "Error loading repo data. Check the console and GitHub Actions logs.";
  }
}

function buildLanguageFilterOptions(repos) {
  const languageSelect = document.getElementById("language-filter");
  const languages = Array.from(
    new Set(
      repos
        .map((r) => r.language)
        .filter((lang) => lang && typeof lang === "string")
    )
  ).sort((a, b) => a.localeCompare(b));

  // Clear existing (keep "All languages" at top)
  while (languageSelect.options.length > 1) {
    languageSelect.remove(1);
  }

  for (const lang of languages) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    languageSelect.appendChild(opt);
  }
}

function applyFilters() {
  const { allRepos, search, language, health, sortBy } = state;

  let result = [...allRepos];

  if (search) {
    result = result.filter((repo) => {
      const name = (repo.name || "").toLowerCase();
      const desc = (repo.description || "").toLowerCase();
      return name.includes(search) || desc.includes(search);
    });
  }

  if (language) {
    result = result.filter((repo) => repo.language === language);
  }

  if (health) {
    result = result.filter((repo) => repo.health === health);
  }

  // Sort
  result.sort((a, b) => compareRepos(a, b, sortBy));

  state.filteredRepos = result;
  renderRepos();
  updateStats();
  updateSummary();
}

function compareRepos(a, b, sortBy) {
  switch (sortBy) {
    case "updated_desc":
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    case "updated_asc":
      return (
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      );
    case "name_asc":
      return a.name.localeCompare(b.name);
    case "name_desc":
      return b.name.localeCompare(a.name);
    case "issues_desc":
      return (b.open_issues || 0) - (a.open_issues || 0);
    default:
      return 0;
  }
}

function renderRepos() {
  const container = document.getElementById("repo-list");
  container.innerHTML = "";

  if (state.filteredRepos.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No repositories match the current filters.";
    empty.style.color = "#a0aec0";
    empty.style.fontSize = "13px";
    container.appendChild(empty);
    return;
  }

  for (const repo of state.filteredRepos) {
    const card = document.createElement("article");
    card.className = "repo-card";

    // Header
    const header = document.createElement("div");
    header.className = "repo-header";

    const nameEl = document.createElement("div");
    nameEl.className = "repo-name";

    const link = document.createElement("a");
    link.href = repo.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = repo.name || repo.full_name || "Unnamed repo";

    nameEl.appendChild(link);

    const badges = document.createElement("div");
    badges.className = "repo-badges";

    // Health badge
    const healthBadge = document.createElement("span");
    healthBadge.className = `badge badge-health-${repo.health || "green"}`;
    const dot = document.createElement("span");
    dot.className = "badge-dot";
    const label = document.createElement("span");
    label.textContent = healthLabel(repo.health);
    healthBadge.appendChild(dot);
    healthBadge.appendChild(label);
    badges.appendChild(healthBadge);

    // Language badge
    if (repo.language) {
      const langBadge = document.createElement("span");
      langBadge.className = "badge badge-language";
      langBadge.textContent = repo.language;
      badges.appendChild(langBadge);
    }

    // Issues badge
    if (typeof repo.open_issues === "number" && repo.open_issues > 0) {
      const issuesBadge = document.createElement("span");
      issuesBadge.className = "badge badge-issues";
      issuesBadge.textContent = `${repo.open_issues} open issue${
        repo.open_issues === 1 ? "" : "s"
      }`;
      badges.appendChild(issuesBadge);
    }

    header.appendChild(nameEl);
    header.appendChild(badges);

    card.appendChild(header);

    // Description
    if (repo.description) {
      const desc = document.createElement("p");
      desc.className = "repo-description";
      desc.textContent = repo.description;
      card.appendChild(desc);
    }

    // Meta
    const meta = document.createElement("div");
    meta.className = "repo-meta";

    const updatedSpan = document.createElement("span");
    updatedSpan.textContent = `Updated ${formatRelativeTime(repo.updated_at)}`;
    meta.appendChild(updatedSpan);

    const fullNameSpan = document.createElement("span");
    fullNameSpan.textContent = repo.full_name || "";
    meta.appendChild(fullNameSpan);

    card.appendChild(meta);

    container.appendChild(card);
  }
}

function healthLabel(health) {
  switch (health) {
    case "green":
      return "Healthy";
    case "yellow":
      return "Needs attention";
    case "red":
      return "Stale";
    default:
      return "Unknown";
  }
}

function updateStats() {
  const total = state.allRepos.length;
  const green = state.allRepos.filter((r) => r.health === "green").length;
  const yellow = state.allRepos.filter((r) => r.health === "yellow").length;
  const red = state.allRepos.filter((r) => r.health === "red").length;

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-green").textContent = green;
  document.getElementById("stat-yellow").textContent = yellow;
  document.getElementById("stat-red").textContent = red;
}

function updateSummary() {
  const count = state.filteredRepos.length;
  const total = state.allRepos.length;
  const summary = document.getElementById("summary-text");

  if (!total) {
    summary.textContent = "No repositories found.";
    return;
  }

  summary.textContent = `Showing ${count} of ${total} repositories. Filter with search, language, health, and sort controls.`;
}

function formatRelativeTime(isoDate) {
  if (!isoDate) return "unknown";

  const then = new Date(isoDate);
  const now = new Date();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays < 1) {
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffHours <= 0) return "just now";
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  if (diffDays < 30) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears} year${diffYears === 1 ? "" : "s"} ago`;
}
