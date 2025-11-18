# Repo Dashboard  
A fast, Cloudflare-powered dashboard that gives you a clean overview of all GitHub repositories for the user **asiakay**.  
The system runs without any local CLI tools and is fully automated through GitHub Actions + Cloudflare Workers.

---

## 🌐 Overview

This dashboard provides:
- A clean UI listing all repositories
- Sorting and filtering options
- Automatic repo health scoring (green, yellow, red)
- Zero secrets exposed to the client
- Updates that run on a schedule (hourly by default)
- Static assets served at the edge through a Cloudflare Worker

The architecture is designed to run entirely from the browser and GitHub's infrastructure—no local development environment required.

---

## 🏛 Architecture

GitHub Actions → generates repos.json → committed to repo → Worker fetches repos.json → Dashboard displays it

### Key Components

#### **1. GitHub Action (`update.yml`)**
- Fetches all GitHub repositories for `asiakay`
- Cleans, normalizes, and scores data
- Generates `public/data/repos.json`
- Commits the updated file automatically

#### **2. Cloudflare Worker (`worker/worker.js`)**
- Serves static files from `public/`
- Provides `/api/repos` endpoint that fetches the latest `repos.json` from GitHub raw
- No GitHub API token required

#### **3. Static Frontend (`public/`)**
- Tailwind-styled dashboard UI
- Sorting (by name, issues, updated_at)
- Filtering (health: green/yellow/red)
- Responsive grid layout
- Optional reusable components (cards, navbars, icons)

---

## 🗂 Folder Structure

```yaml
repo-dashboard/
  public/
    index.html
    styles.css
    components/
      card.html
      navbar.html
    js/
      filters.js
      sorting.js
      health.js
    icons/
      green.svg
      yellow.svg
      red.svg
    data/
      repos.json       # auto-generated
    assets/
      logo.png
  worker/
    worker.js
  .github/
    workflows/
      update.yml
  scripts/
    process-repos.js
    validate-json.js
  tests/
    worker.test.js
  docs/
    architecture.md
    routes.md

# 🚀 Deployment
1. GitHub Actions

No local commands needed.

To enable automatic updates:

Go to Settings → Secrets → Actions

Add a secret named:
