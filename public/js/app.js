let allRepos = [];
let filteredRepos = [];

let currentPage = 1;
const perPage = 12;

async function loadRepos() {
  const res = await fetch("/data/repos.json");
  allRepos = await res.json();

  filteredRepos = allRepos;

  populateLanguageFilter();
  render();
}

function populateLanguageFilter() {
  const select = document.getElementById("languageFilter");
  const langs = [...new Set(allRepos.map(r => r.language).filter(Boolean))];

  langs.sort();
  langs.forEach(lang => {
    let opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    select.appendChild(opt);
  });
}

function render() {
  const grid = document.getElementById("repoGrid");
  grid.innerHTML = "";

  const pageRepos = filteredRepos.slice((currentPage - 1) * perPage, currentPage * perPage);

  pageRepos.forEach(repo => {
    grid.innerHTML += `
      <div class="repo-card">
        <div class="repo-title">
          <a href="${repo.url}" target="_blank">${repo.name}</a>
        </div>
        <div class="repo-desc">${repo.description || "No description."}</div>

        <div class="badges">
          <div class="badge ${repo.health}">${repo.health.toUpperCase()}</div>
          ${repo.language ? `<div class="badge">${repo.language}</div>` : ""}
        </div>

        <div class="meta">Updated: ${new Date(repo.updated_at).toLocaleDateString()}</div>
      </div>
    `;
  });

  document.getElementById("pageInfo").textContent =
    `Page ${currentPage} of ${Math.ceil(filteredRepos.length / perPage)}`;
}

document.getElementById("search").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  filteredRepos = allRepos.filter(r =>
    r.name.toLowerCase().includes(q) ||
    (r.description || "").toLowerCase().includes(q)
  );
  currentPage = 1;
  render();
});

document.getElementById("languageFilter").addEventListener("change", e => {
  const lang = e.target.value;
  filteredRepos = lang
    ? allRepos.filter(r => r.language === lang)
    : allRepos;

  currentPage = 1;
  render();
});

document.getElementById("prevBtn").addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    render();
  }
});

document.getElementById("nextBtn").addEventListener("click", () => {
  if (currentPage < Math.ceil(filteredRepos.length / perPage)) {
    currentPage++;
    render();
  }
});

loadRepos();
