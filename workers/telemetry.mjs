/**
 * telemetry.mjs — traces for every LLM call, written to the same SQLite file.
 *
 * Uses the OpenTelemetry SDK and the GenAI semantic conventions, but exports to
 * a local table instead of a collector. There is no Docker on this machine, and
 * a hosted backend would mean shipping prompts to a third party to answer a
 * question that is local: what did this run cost, and where did the time go.
 *
 * Import once at process start:
 *   import { initTelemetry } from './telemetry.mjs';
 *   initTelemetry('scout-api');
 */
import { createRequire } from 'module';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const DB_PATH = join(dirname(fileURLToPath(import.meta.url)), 'applications.db');

/**
 * Per-million-token pricing, input/output. Kept here rather than fetched:
 * a cost number that silently changes when a provider updates a page is worse
 * than one that is visibly stale. Update by hand when it moves.
 * Sources checked 2026-08.
 */
const PRECIOS = {
  'openai/gpt-oss-120b':      { in: 0.15,  out: 0.60 },
  'llama-3.3-70b-versatile':  { in: 0.59,  out: 0.79 },
  'llama-3.1-8b-instant':     { in: 0.05,  out: 0.08 },
  'claude-sonnet-4-6':        { in: 3.00,  out: 15.00 },
  'deepseek/deepseek-v4-flash': { in: 0.09, out: 0.18 },
};

function costo(model, inTok, outTok) {
  const p = PRECIOS[model];
  if (!p) return null; // unknown model: report nothing rather than guess zero
  return +(((inTok || 0) * p.in + (outTok || 0) * p.out) / 1e6).toFixed(6);
}

/** Writes finished spans straight into SQLite. */
class SqliteSpanExporter {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spans (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id    TEXT NOT NULL,
        span_id     TEXT NOT NULL,
        parent_id   TEXT,
        name        TEXT NOT NULL,
        service     TEXT,
        started_at  TEXT NOT NULL,
        ms          INTEGER NOT NULL,
        status      TEXT,
        error       TEXT,
        model       TEXT,
        provider    TEXT,
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        cost_usd    REAL,
        attrs       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_spans_time  ON spans(started_at);
    `);
    this.stmt = this.db.prepare(`
      INSERT INTO spans (trace_id, span_id, parent_id, name, service, started_at, ms,
                         status, error, model, provider, tokens_in, tokens_out, cost_usd, attrs)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
  }

  export(spans, done) {
    for (const s of spans) {
      const a = s.attributes || {};
      const inTok = a['gen_ai.usage.input_tokens'];
      const outTok = a['gen_ai.usage.output_tokens'];
      const model = a['gen_ai.response.model'] || a['gen_ai.request.model'];
      const [sec, nano] = s.startTime;
      try {
        this.stmt.run(
          s.spanContext().traceId,
          s.spanContext().spanId,
          s.parentSpanContext?.spanId || null,
          s.name,
          a['service.name'] || null,
          new Date(sec * 1000 + nano / 1e6).toISOString().replace('T', ' ').slice(0, 23),
          Math.round(s.duration[0] * 1000 + s.duration[1] / 1e6),
          s.status?.code === SpanStatusCode.ERROR ? 'error' : 'ok',
          s.status?.message || null,
          model || null,
          a['gen_ai.system'] || null,
          inTok ?? null,
          outTok ?? null,
          model ? costo(model, inTok, outTok) : null,
          JSON.stringify(a),
        );
      } catch { /* telemetry must never break the run it is measuring */ }
    }
    done?.({ code: 0 });
  }

  shutdown() { try { this.db.close(); } catch {} return Promise.resolve(); }
  forceFlush() { return Promise.resolve(); }
}

let tracer = null;

export function initTelemetry(serviceName = 'job-hunter') {
  if (tracer) return tracer;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [new SimpleSpanProcessor(new SqliteSpanExporter())],
  });
  provider.register();
  tracer = trace.getTracer(serviceName);
  return tracer;
}

export function getTracer() {
  return tracer || initTelemetry();
}

/**
 * Wraps one LLM call in a span using the GenAI semantic conventions, so the
 * attribute names match what any OTel-aware backend expects if this ever moves
 * off SQLite.
 *
 * fn must return { text, model, usage: { input, output } }.
 */
export async function spanLLM({ provider, model, operation = 'chat' }, fn) {
  const t = getTracer();
  return t.startActiveSpan(`${operation} ${model}`, async span => {
    span.setAttribute('gen_ai.system', provider);
    span.setAttribute('gen_ai.request.model', model);
    span.setAttribute('gen_ai.operation.name', operation);
    try {
      const r = await fn();
      if (r?.model) span.setAttribute('gen_ai.response.model', r.model);
      if (r?.usage?.input != null) span.setAttribute('gen_ai.usage.input_tokens', r.usage.input);
      if (r?.usage?.output != null) span.setAttribute('gen_ai.usage.output_tokens', r.usage.output);
      span.setStatus({ code: SpanStatusCode.OK });
      return r;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err.message).slice(0, 300) });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Wraps a whole unit of work, so LLM spans hang under something meaningful. */
export async function spanTask(name, attrs, fn) {
  const t = getTracer();
  return t.startActiveSpan(name, async span => {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v != null) span.setAttribute(k, v);
    }
    try {
      const r = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return r;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err.message).slice(0, 300) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export { trace, context };
