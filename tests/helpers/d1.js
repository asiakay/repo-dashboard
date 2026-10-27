// A D1 binding backed by a real in-memory SQLite database (node:sqlite), so
// tests execute the actual SQL against the actual db/schema.sql instead of
// pattern-matching query strings. Implements the subset of the D1 API the
// functions use: prepare().bind().first() / .all() / .run().

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Loaded through require: Vite 5's resolver doesn't list node:sqlite as a
// builtin and would try to resolve it as an npm package.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

export const SCHEMA_SQL = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");

export function createD1({ schema = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  if (schema) sqlite.exec(SCHEMA_SQL);

  const binding = {
    sqlite,
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...values) {
          params = values;
          return stmt;
        },
        async first() {
          return sqlite.prepare(sql).get(...params) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...params) };
        },
        async run() {
          const r = sqlite.prepare(sql).run(...params);
          return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return stmt;
    },
  };
  return binding;
}
