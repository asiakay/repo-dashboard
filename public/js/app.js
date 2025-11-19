let allRepos = [];
let filteredRepos = [];

// DOM refs
const searchInput = document.getElementById("search");
const languageFilter = document.getElementById("language-filter");
const healthFilter = document.getElementById("health-filter");
const sortBy = document.getElementById("sort-by");
const repoList = document.getElementById("repo-list");
const summaryText = document.getElementById("summary-text");

// Stats pills
const statTotal = document.getElementById("stat-total");
const statGreen = document.getElementById("stat-green");
const statYellow = document.getElementById("stat-yellow");
const statRed = document.getElementById("stat-red");

async function loadRepos() {
  try {
    const res = await fetch("/data/repos.json");
    allRepos = await res.json();

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

// Build the language dropdown dynamically
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

// Update top stat pills
function updateStats() {
  statTotal.textContent = allRepos.length;
  statGreen.textContent = allRepos.filter(r => r.health === "green").length;
  statYellow.textContent = allRepos.filter(r => r.health === "yellow").length;
  statRed.textContent = allRepos.filter(r => r.health === "red").length;
}

function applyFilters() {
  let q = searchInput.value.toLowerCase();
  let lang = languageFilter.value;
  let health = healthFilter.value;

  filteredRepos = allRepos.filter(repo => {

    let matchesSearch =
      repo.name.toLowerCase().includes(q) ||
      (repo.description || "").toLowerCase().includes(q);

    let matchesLanguage = lang ? repo.language === lang : true;

    let matchesHealth = health ? repo.health === health : true;

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
      case "updated_desc":
        return new Date(b.updated_at) - new Date(a.updated_at);
      case "updated_asc":
        return new Date(a.updated_at) - new Date(b.updated_at);
      case "name_asc":
        return a.name.localeCompare(b.name);
      case "name_desc":
        return b.name.localeCompare(a.name);
      case "issues_desc":
        return (b.open_issues || 0) - (a.open_issues || 0);
      default:
        return 0;
    }
  });
}

// Render each repo card with your neon cosmic style
function renderRepos() {
  repoList.innerHTML = "";

  if (!filteredRepos.length) {
    repoList.innerHTML = `<p style="color:var(--text-muted); padding:10px;">No repositories found.</p>`;
    return;
  }

  filteredRepos.forEach(repo => {
    const updated = new Date(repo.updated_at).toLocaleDateString();
    const issues = repo.open_issues || 0;

    const card = `
      <div class="repo-card">
        <div class="repo-header">
          <div class="repo-name">
            <a href="${repo.url}" target="_blank">${repo.name}</a>
          </div>

          <div class="repo-badges">
            <span class="badge badge-health-${repo.health}">
              <span class="badge-dot"></span>${repo.health.toUpperCase()}
            </span>

            ${repo.language ? `
            <span class="badge badge-language">
              ${repo.language}
            </span>` : ""}

            ${issues > 0 ? `
            <span class="badge badge-issues">
              ${issues} issues
            </span>` : ""}
          </div>
        </div>

        <p class="repo-description">
          ${repo.description || "No description."}
        </p>

        <div class="repo-meta">
          <span>Updated: ${updated}</span>
          <span>Branch: ${repo.default_branch || "main"}</span>
        </div>
      </div>
    `;

    repoList.insertAdjacentHTML("beforeend", card);
  });
}

// Event listeners
searchInput.addEventListener("input", applyFilters);
languageFilter.addEventListener("change", applyFilters);
healthFilter.addEventListener("change", applyFilters);
sortBy.addEventListener("change", () => {
  applySorting();
  renderRepos();
});

// Bootload
loadRepos();
