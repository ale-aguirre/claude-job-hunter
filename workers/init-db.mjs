#!/usr/bin/env node
/**
 * init-db.mjs — Initialize the jobs database
 * Run once before first use: node init-db.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'applications.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company      TEXT NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT,
    source       TEXT DEFAULT 'manual',
    status       TEXT DEFAULT 'found',
    cv_used      TEXT DEFAULT '',
    easy_apply   INTEGER DEFAULT 0,
    cover_letter TEXT DEFAULT '',
    salary       TEXT DEFAULT '',
    location     TEXT DEFAULT 'Remote',
    applied_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    notes        TEXT DEFAULT '',
    platform     TEXT DEFAULT '',
    pay_hr       REAL DEFAULT 0,
    pay_mo       REAL DEFAULT 0,
    posted_at    TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS agent_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent      TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    status     TEXT DEFAULT 'ok',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income_streams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    type        TEXT DEFAULT 'freelance',
    status      TEXT DEFAULT 'active',
    monthly_usd REAL DEFAULT 0,
    notes       TEXT DEFAULT '',
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_key   TEXT NOT NULL,
    signal      TEXT NOT NULL,
    reason      TEXT DEFAULT '',
    created_by  TEXT DEFAULT '',
    resolved_at TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_queue (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name       TEXT NOT NULL,
    task_type        TEXT NOT NULL,
    payload          TEXT DEFAULT '{}',
    status           TEXT DEFAULT 'pending',
    priority         INTEGER DEFAULT 5,
    reason           TEXT DEFAULT '',
    success_criteria TEXT DEFAULT '',
    result           TEXT DEFAULT '',
    error            TEXT DEFAULT '',
    created_at       TEXT DEFAULT (datetime('now')),
    started_at       TEXT,
    completed_at     TEXT
  );
`);

db.close();
console.log('applications.db initialized.');
