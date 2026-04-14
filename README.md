# Job Hunter — Claude Code Skill

A job hunting agent that runs inside Claude Code. No API keys required — Claude is the engine.

Works for any profession: developer, designer, electrician, marketer, accountant.

---

## How it works

Claude orchestrates everything using its built-in tools:
- **WebSearch + WebFetch** to find and read job listings
- **Bash** to run Node.js workers for job board scraping and applications
- **Playwright MCP** (optional) to fill forms automatically

You interact through slash commands. Claude does the rest.

---

## Quick Start

```
/job-hunter setup
```

The wizard will ask you a few questions (2 min), verify your environment, and generate `profile.json`.

---

## Commands

| Command | What it does |
|---------|-------------|
| `/job-hunter setup` | First-time onboarding wizard |
| `/job-hunter hunt` | Search for new job opportunities |
| `/job-hunter apply` | Review and apply to top matches |
| `/job-hunter status` | See your pipeline (found / applied / interviews) |
| `/job-hunter dashboard` | Open visual panel at localhost:4242 |
| `/job-hunter research <company>` | Deep dive on a company before applying |
| `/job-hunter letter <url>` | Generate a cover letter for a specific job |
| `/job-hunter help` | Show all commands |

---

## Installation

### 1. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Add this skill

Copy or clone this repo and symlink the skill:

```bash
git clone https://github.com/YOUR_USER/job-hunter ~/.claude/skills/job-hunter
```

Or manually: copy `SKILL.md` to `~/.claude/skills/job-hunter/SKILL.md`.

### 3. Install worker dependencies

```bash
cd workers && npm install
```

### 4. Run the wizard

Open Claude Code and run:

```
/job-hunter setup
```

---

## Project Structure

```
job-hunter/
├── SKILL.md              ← Entry point for Claude Code
├── wizard.md             ← Onboarding flow (loaded by setup command)
├── profile.example.json  ← Schema for your profile
├── workers/              ← Node.js scripts Claude calls via Bash
│   ├── scout-api.mjs     ← Scrapes job boards (Fern agent)
│   ├── agent-xreddit.mjs ← Searches X/Reddit (Kaguya agent)
│   ├── apply-from-db.mjs ← Fills and submits applications (Reigen agent)
│   ├── cleanup-db.mjs    ← DB stats and maintenance
│   └── ...
├── agents/               ← Prompts for specialized sub-agents
├── boards/               ← Job board lists by profession
│   ├── universal.md      ← Always included
│   ├── tech.md
│   ├── creative.md
│   ├── trades.md
│   ├── marketing.md
│   └── business.md
└── dashboard/            ← Optional web UI (localhost:4242)
```

---

## What gets saved

- `profile.json` — Your profile (not committed, in .gitignore)
- `jobs.db` — SQLite database with all opportunities found
- `.env` — API keys if you want faster LLM fallback (optional)

---

## Optional: faster LLM fallback

By default, Claude handles everything. If you want faster processing for repetitive tasks (cover letters, scoring), add a `workers/.env`:

```env
GROQ_API_KEY=your_groq_key   # free at groq.com
```

Workers will use Groq for simple tasks and Claude for reasoning. If no key is set, everything runs through Claude.

---

## Privacy

`profile.json`, `jobs.db`, and `.env` are in `.gitignore`. Your personal data never leaves your machine unless you explicitly push.

---

## Agents

| Agent | Role |
|-------|------|
| Fern | Searches job boards, classifies opportunities |
| Kaguya | Searches X/Twitter and Reddit for hiring posts |
| Reigen | Fills ATS forms and submits applications |
| Erwin | Analyzes market trends, recommends what to prioritize |

---

## Requirements

- Claude Code (CLI or desktop app)
- Node.js 18+
- npm

Optional:
- Playwright MCP (for automatic form filling)
- Groq API key (free — for faster cover letter generation)
- Active Chrome session (for Twitter/X scraping)

---

## License

MIT
