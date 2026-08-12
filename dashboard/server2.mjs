#!/usr/bin/env node
/**
 * server2.mjs — the small dashboard.
 *
 * The old one is 3,122 lines across seven files, with anime avatars and a
 * character name per worker. This one answers three questions and nothing else:
 * what should I apply to, what am I waiting on, and what went quiet.
 *
 * Run: node server2.mjs        (PORT env, default 3000)
 */
import { createServer } from 'http';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const DIR = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(DIR, '..', 'workers', '.env') });

const PORT = parseInt(process.env.PORT || '3000');
const DB_PATH = process.env.HUNTDESK_DB_PATH || path.join(DIR, '..', 'workers', 'applications.db');
const db = new Database(DB_PATH);

const json = (res, data, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

/** Days since a timestamp, or null. Used everywhere to sort by staleness. */
const DAYS = "CAST(julianday('now') - julianday(%s) AS INTEGER)";

const queries = {
  // Worth applying to: still open, scored, newest first.
  todo: () => db.prepare(`
    SELECT id, company, title, url, source, score, location, salary, alive,
           ${DAYS.replace('%s', 'applied_at')} AS dias_desde_encontrado,
           email_contact,
           CASE
             WHEN url LIKE '%ashbyhq.com%' OR url LIKE '%lever.co%'
               OR url LIKE '%greenhouse.io%' OR url LIKE '%workable.com%' THEN 'auto'
             WHEN email_contact IS NOT NULL AND email_contact != '' THEN 'semi'
             ELSE 'manual'
           END AS balde
    FROM applications
    WHERE status = 'found'
    ORDER BY CASE alive WHEN 'viva' THEN 0 WHEN 'incierta' THEN 1 ELSE 2 END,
             score DESC, applied_at DESC
    LIMIT 220
  `).all(),

  // Sent and still silent. Sorted by how long they have been silent.
  esperando: () => db.prepare(`
    SELECT id, company, title, url, sent_at, notes, outcome,
           ${DAYS.replace('%s', 'sent_at')} AS dias_sin_respuesta
    FROM applications
    WHERE status = 'applied' AND replied_at IS NULL AND outcome = ''
    ORDER BY sent_at DESC
    LIMIT 80
  `).all(),

  // Anything with a human on the other side.
  activas: () => db.prepare(`
    SELECT id, company, title, url, sent_at, replied_at, outcome, notes
    FROM applications
    WHERE replied_at IS NOT NULL OR outcome <> ''
    ORDER BY COALESCE(replied_at, sent_at) DESC
    LIMIT 40
  `).all(),

  // What the runs actually cost. The spans table is written by telemetry.mjs
  // using the OpenTelemetry GenAI conventions.
  telemetria: () => {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spans'").get();
    if (!has) return null;
    return {
      por_modelo: db.prepare(`
        SELECT model, provider, COUNT(*) AS llamadas, CAST(AVG(ms) AS INTEGER) AS ms_prom,
               SUM(tokens_in) AS tok_in, SUM(tokens_out) AS tok_out,
               ROUND(SUM(cost_usd), 5) AS costo,
               SUM(status='error') AS errores
        FROM spans WHERE model IS NOT NULL
        GROUP BY model ORDER BY llamadas DESC
      `).all(),
      total: db.prepare(`
        SELECT COUNT(*) AS llamadas, ROUND(SUM(cost_usd), 5) AS costo,
               CAST(AVG(ms) AS INTEGER) AS ms_prom, SUM(status='error') AS errores,
               MAX(started_at) AS ultima
        FROM spans WHERE model IS NOT NULL
      `).get(),
    };
  },

  resumen: () => {
    const g = sql => db.prepare(sql).get();
    return {
      para_aplicar: g("SELECT COUNT(*) n FROM applications WHERE status='found'").n,
      vivas: g("SELECT COUNT(*) n FROM applications WHERE status='found' AND alive='viva'").n,
      nuevas: g("SELECT COUNT(*) n FROM applications WHERE status='found' AND julianday('now')-julianday(applied_at) <= 2").n,
      dias_desde_scout: g(`SELECT ${DAYS.replace('%s', 'MAX(applied_at)')} n FROM applications`).n,
      enviadas: g("SELECT COUNT(*) n FROM applications WHERE status='applied'").n,
      esperando: g("SELECT COUNT(*) n FROM applications WHERE status='applied' AND replied_at IS NULL AND outcome=''").n,
      con_respuesta: g("SELECT COUNT(*) n FROM applications WHERE replied_at IS NOT NULL").n,
      vencidas: g("SELECT COUNT(*) n FROM applications WHERE outcome='timeout'").n,
      ultima_enviada: g("SELECT MAX(sent_at) d FROM applications").d,
      dias_sin_aplicar: g(`SELECT ${DAYS.replace('%s', 'MAX(sent_at)')} n FROM applications`).n,
    };
  },
};

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(path.join(DIR, 'index2.html')));
  }

  if (u.pathname === '/api/data') {
    // 30 días de silencio = descartada por tiempo. Se archiva sola: seguir
    // mostrándola como "waiting" es mentirse.
    db.prepare(`
      UPDATE applications SET status='archived', outcome='timeout',
             updated_at = datetime('now')
      WHERE status='applied' AND replied_at IS NULL AND outcome=''
        AND julianday('now') - julianday(sent_at) > 30
    `).run();
    return json(res, {
      resumen: queries.resumen(),
      telemetria: queries.telemetria(),
      todo: queries.todo(),
      esperando: queries.esperando(),
      activas: queries.activas(),
    });
  }

  // Marking things by hand is the whole point: the agent cannot know that a
  // recruiter answered on LinkedIn, or that Alexis applied somewhere himself.
  if (u.pathname === '/api/mark' && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const { id, outcome } = JSON.parse(body);
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        if (outcome === 'aplicada') {
          db.prepare("UPDATE applications SET status='applied', sent_at=?, updated_at=? WHERE id=?").run(now, now, id);
        } else if (outcome === 'descartada') {
          db.prepare("UPDATE applications SET status='archived', updated_at=? WHERE id=?").run(now, id);
        } else {
          // respondio | entrevista | rechazado | oferta
          db.prepare('UPDATE applications SET outcome=?, replied_at=COALESCE(replied_at,?), updated_at=? WHERE id=?')
            .run(outcome, now, now, id);
        }
        json(res, { ok: true });
      } catch (e) {
        json(res, { error: e.message }, 400);
      }
    });
    return;
  }

  // Two bulk actions, no reasons. The pending leads are old enough that "why"
  // is always the same answer, and asking for it turns a two-click cleanup into
  // a form.
  if (u.pathname === '/api/bulk' && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try {
        const { ids, accion } = JSON.parse(body);
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const stmt = accion === 'aplique'
          ? db.prepare("UPDATE applications SET status='applied', sent_at=?, updated_at=? WHERE id=?")
          : db.prepare("UPDATE applications SET status='archived', updated_at=? WHERE id=?");
        const tx = db.transaction(list => list.forEach(id =>
          accion === 'aplique' ? stmt.run(now, now, id) : stmt.run(now, id)));
        tx(ids);
        json(res, { ok: true, n: ids.length });
      } catch (e) { json(res, { error: e.message }, 400); }
    });
    return;
  }

  res.writeHead(404).end('not found');
});

// 127.0.0.1: el dashboard muestra tu búsqueda laboral entera — nadie de la LAN tiene por qué verla.
server.listen(PORT, '127.0.0.1', () => console.log(`\njob-hunter en http://localhost:${PORT}\n`));
