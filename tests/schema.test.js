// db/schema.sql is re-applied to production D1 on every push to main
// (.github/workflows/deploy.yml), so it must be idempotent. These tests run it
// against real SQLite to prove that, and to catch syntax errors before deploy.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createD1, SCHEMA_SQL } from "./helpers/d1.js";

const MIGRATION_0011 = readFileSync(new URL("../db/migrations/0011_repo_cache_and_site_status.sql", import.meta.url), "utf8");

function tables(DB) {
  return DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
}

describe("db/schema.sql", () => {
  it("applies cleanly to an empty database", () => {
    const DB = createD1();
    expect(tables(DB)).toEqual(expect.arrayContaining(["work_items", "okrs", "tasks", "cache_entries", "site_status"]));
  });

  it("can be re-applied without errors or duplicate seed rows", () => {
    const DB = createD1();
    const seeded = DB.sqlite.prepare("SELECT COUNT(*) AS n FROM work_items").get().n;
    expect(seeded).toBeGreaterThan(0);

    DB.sqlite.exec(SCHEMA_SQL);
    DB.sqlite.exec(SCHEMA_SQL);
    expect(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM work_items").get().n).toBe(seeded);
  });

  it("keeps existing cache and site_status rows when re-applied", () => {
    const DB = createD1();
    DB.sqlite.prepare("INSERT INTO cache_entries (key, value, expires_at) VALUES ('k', '{}', 1)").run();
    DB.sqlite.prepare("INSERT INTO site_status VALUES ('r', 'https://r.example', 0, 200, '2026-10-27T00:00:00Z')").run();
    DB.sqlite.exec(SCHEMA_SQL);
    expect(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM cache_entries").get().n).toBe(1);
    expect(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM site_status").get().n).toBe(1);
  });

  it("rejects an invalid site_status.is_error", () => {
    const DB = createD1();
    expect(() => DB.sqlite.prepare("INSERT INTO site_status VALUES ('r', 'h', 2, NULL, 't')").run()).toThrow(/CHECK/);
  });
});

describe("migration 0011", () => {
  it("is a no-op on a database that already has the schema", () => {
    const DB = createD1();
    expect(() => DB.sqlite.exec(MIGRATION_0011)).not.toThrow();
  });

  it("creates both tables on a database without them", () => {
    const DB = createD1({ schema: false });
    DB.sqlite.exec(MIGRATION_0011);
    expect(tables(DB)).toEqual(["cache_entries", "site_status"]);
  });
});
