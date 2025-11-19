let repos = [];
let filtered = [];

const repoGrid = document.getElementById("repo-grid");
const searchInput = document.getElementById("search");
const filterLanguage = document.getElementById("filter-language");
const filterHealth = document.getElementById("filter-health");
const sortSelect = document.getElementById("sort");

// -----------------------------------
// Load the repo data
// -----------------------------------
async function loadRepos() {
  const res = await fetch("data/repos.json");
  repos = await res.json();
  filtered = repos.slice();

  populateLanguages();
  render();
}

// -----------------------------------
// Populate languages dropdown
// -----------------------------------
function populateLanguages() {
  const langs = [...new Set(repos.map(r => r.language).filter(Boolean))];

  langs.sort().forEach(lang => {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    filterLanguage.appendChild(opt);
  });
}

// -----------------------------------
// Render cards
// -----------------------------------
function render() {
  repoGrid.innerHTML = "";

  filtered.forEach(repo => {
    const card = document.createElement("div");
    card.classList.add("repo-card");

    card.innerHTML = `
      <div class="repo-top">
        <a href="${repo.url}" class="repo-name" target="_blank">${repo.name}</a>
        <span class="badge ${repo.health}">${repo.health}</span>
      </div>

      <p class="description">
        ${repo.description || "No description provided."}
      </p>

      <div class="meta">
        <div>Language: ${repo.language || "Unknown"}</div>
        <div>Open Issues: ${repo.open_issues}</div>
        <div>Updated: ${new Date(repo.updated_at).toLocaleDateString()}</div>
      </div>
    `;

    repoGrid.appendChild(card);
  });
}

// -----------------------------------
// Search
// -----------------------------------
searchInput.addEventListener("input", () => {
  const q = searchInput.value.toLowerCase();
  filtered = repos.filter(r => r.name.toLowerCase().includes(q));
  applyFilters();
});

// -----------------------------------
// Filters
// -----------------------------------
function applyFilters() {
  const lang = filterLanguage.value;
  const health = filterHealth.value;

  filtered = repos.filter(r => {
    return (
      (lang ? r.language === lang : true) &&
      (health ? r.health === health : true) &&
      (searchInput.value
        ? r.name.toLowerCase().includes(searchInput.value.toLowerCase())
        : true)
    );
  });

  applySort();
  render();
}

// -----------------------------------
// Sorting
// -----------------------------------
function applySort() {
  const mode = sortSelect.value;

  if (mode === "updated") {
    filtered.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }
  else if (mode === "issues") {
    filtered.sort((a, b) => b.open_issues - a.open_issues);
  }
  else if (mode === "name") {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
}

sortSelect.addEventListener("change", applyFilters);
filterLanguage.addEventListener("change", applyFilters);
filterHealth.addEventListener("change", applyFilters);

// -----------------------------------
// Start
// -----------------------------------
loadRepos();
