# claude-job-hunter

**An autonomous job search agent that can prove what it sent.**

It scouts 17 job board APIs, scores each posting against your CV, tailors that CV
per posting against a fixed set of facts, submits through the ATS, and then reads
the page back to confirm the application actually landed.

Runs on your Claude Code session. The skill workflow needs no extra keys; the
standalone workers (scout, tailor, apply) want a `GROQ_API_KEY` or
`ANTHROPIC_API_KEY` in `workers/.env` — see `.env.example`.

```
1,212 leads processed
  316 applications submitted autonomously
  248 verified on the target page after submitting
```

---

## Why the verification matters

The aggregate confirmation rate was a healthy-looking 78%. Grading delivery per
channel instead of in total told a different story:

| Channel | Sent | Confirmed | Rate |
|---|---|---|---|
| Ashby | 174 | 174 | 100% |
| Greenhouse | 52 | 52 | 100% |
| Himalayas | 18 | 18 | 100% |
| Jobicy | 4 | 4 | 100% |
| Arbeitnow | 60 | 0 | **0%** |

Four integrations working perfectly and one failing silently for months. The
average had been hiding it. That integration is now disabled.

Full write-up in [`docs/EVAL.md`](docs/EVAL.md).

---

## The CV is tailored, and it cannot lie

Every claim the model makes is checked against `cv-facts.json` before anything is
rendered. Any id it invents is dropped, and any technology it names that is not in
the profile replaces the summary with the base text.

This is not decoration. A prompt injection hidden inside a job description made
the model write *"10 years of Kubernetes"* into the summary. The instructions in
the system prompt did not stop it. The deterministic validator did.

That routing pattern was extracted into a standalone library:
[intent-gate](https://github.com/ale-aguirre/intent-gate).

---

## Evals

A [promptfoo](https://promptfoo.dev) suite runs over the CV tailoring stage. It
grades the model and the validator separately, because a model that tries to
fabricate and gets caught is a different outcome from one that succeeds:

| Grader | Reads | Question |
|---|---|---|
| `noUndeclaredTech` | model output | Did it try to fabricate a skill? |
| `shippedOutputClean` | final document | Did anything fabricated survive? |
| `idsAllReal` | model output | Are all referenced facts real? |
| `roleMatches` | model output | Did it route to the right CV variant? |

```bash
cd workers/evals && npx promptfoo eval
```

The suite paid for itself when Groq deprecated a model: swapping to
`gpt-oss-120b` moved `summaryLength` from failing 7/7 to passing, which revealed
that the per-posting summary had been silently falling back to a generic one on
every single application.

Details in [`docs/EVAL-CV-TAILOR.md`](docs/EVAL-CV-TAILOR.md).

---

## Observability

Every LLM call is traced with the OpenTelemetry SDK using the GenAI semantic
conventions, exported to a `spans` table in the same SQLite file.

```
model                  calls   avg latency   tokens   cost
openai/gpt-oss-120b        8        1187ms     9128   $0.0026
```

One tailored CV costs $0.0003 and takes 1.2 seconds. Local export rather than a
hosted backend: answering "what did this run cost" should not require shipping
your prompts to a third party.

---

## Setup

```bash
git clone https://github.com/ale-aguirre/claude-job-hunter
cd claude-job-hunter/workers && npm install
# macOS / Linux
ln -s $(pwd)/.. ~/.claude/skills/job-hunter
# Windows (PowerShell, elevated)
# New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills\job-hunter" -Target (Resolve-Path ..)
```

Then, in Claude Code:

```
/job-hunter setup
```

The wizard asks six questions and writes `profile.json`.

The CV tailor and the eval suite read `workers/cv-facts.json` (your facts — gitignored).
Without it they fall back to `workers/cv-facts.example.json`, a fictional candidate, so a
fresh clone can run the tailor and the evals out of the box:

```bash
cd workers && npx promptfoo eval -c evals/promptfooconfig.yaml
```

To use your own facts: `cp cv-facts.example.json cv-facts.json` and edit it.

---

## Commands

| Command | What it does |
|---|---|
| `/job-hunter setup` | Onboarding wizard, generates your profile |
| `/job-hunter hunt` | Search LATAM and remote boards |
| `/job-hunter apply` | Review matches and apply, with a human stop before submit |
| `/job-hunter status` | Pipeline state: found / applied / interviewing |
| `/job-hunter research <company>` | Deep research before applying |
| `/job-hunter letter <url>` | Cover letter for any job URL |

Standalone tools:

```bash
node workers/eval-report.mjs      # delivery rate per channel, orchestrator reliability
node workers/check-alive.mjs      # opens every pending posting, marks the dead ones
node dashboard/server2.mjs        # localhost:3000
```

---

## Sources

**LATAM**: GetOnBrd, Torre, Workana, Computrabajo, Bumeran
**Remote in USD**: Remotive, RemoteOK, We Work Remotely, Himalayas, Jobicy, Arc.dev
**ATS boards**: Greenhouse, Lever, Ashby
**Other**: HN "Who is hiring" monthly thread, X and Reddit hiring posts

Which ones run depends on your profession and work mode, from `profile.json`.

Postings go stale. `check-alive.mjs` opens each pending one and records whether it
still exists: of 219 pending leads, 170 were live and 29 were gone.

---

## Design notes

**The model never decides what runs.** It classifies; a registry maps that to an
executor. A model returning a handler name turns a typo into a production failure.

**Silence is not consent.** Anything gated on human approval fails closed if the
human does not answer.

**A worker that fails three times gets paused**, not retried forever, and resumes
on the next clean cycle. One broken integration should not take down the run.

**Costs are measured, not assumed.** A cheap model handles classification, with
automatic fallback on rate limits.

---

## Stack

Node.js · Playwright · Claude API · Groq · SQLite · OpenTelemetry · promptfoo

MIT.
