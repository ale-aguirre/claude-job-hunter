# claude-job-hunter

**A job hunting agent built on top of Claude Code.** No API keys required — Claude is the engine.

You talk to it with slash commands. It searches job boards, scans social media, writes cover letters, and applies automatically. Works for any profession.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-required-blueviolet)](https://claude.ai/code)
[![Support](https://img.shields.io/badge/Support-Ko--fi-ff5e5b)](https://ko-fi.com/aleaguirre)

---

## How it works

You don't need an Anthropic API key. Claude Code (the app you already use) is the engine. The Node.js workers handle scraping and browser automation. Claude handles reasoning, prioritization, and writing.

```
/job-hunter setup   ← first time, takes 2 minutes
/job-hunter hunt    ← search for new jobs
/job-hunter apply   ← review matches and apply
/job-hunter status  ← see your pipeline
```

---

## Setup (2 minutes)

### 1. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Already have it? Skip.

### 2. Clone and install

```bash
git clone https://github.com/ale-aguirre/claude-job-hunter
cd claude-job-hunter/workers && npm install
```

### 3. Add as a Claude Code skill

```bash
ln -s $(pwd)/.. ~/.claude/skills/job-hunter
```

### 4. Run the wizard

Open Claude Code (terminal or desktop app) and type:

```
/job-hunter setup
```

The wizard asks 6 questions about your profile, generates `profile.json`, and runs a test search. Done.

---

## Commands

| Command | What it does |
|---------|-------------|
| `/job-hunter setup` | Onboarding wizard — creates your profile |
| `/job-hunter hunt` | Search job boards + X/Reddit for new opportunities |
| `/job-hunter apply` | Review top matches and apply with AI-written cover letters |
| `/job-hunter status` | Pipeline overview: found / applied / interviews |
| `/job-hunter dashboard` | Open visual panel at `localhost:4242` |
| `/job-hunter research <company>` | Deep research on a company before applying |
| `/job-hunter letter <url>` | Generate a cover letter for any job URL |
| `/job-hunter help` | Show all commands |

---

## What it searches

Configured automatically based on your profession. Always includes:

- Remote OK, Remotive, We Work Remotely
- Upwork, Contra, Workana (LATAM)
- Torre, GetOnBrd (LATAM)
- HN Who's Hiring, Reddit r/forhire
- X/Twitter hiring posts (optional, needs Chrome session)

For developers, also:
- Arc.dev, Braintrust, Lemon.io, Andela, Wellfound
- Outlier.ai, Scale AI, Alignerr (AI training gigs)

---

## Optional: Groq key for faster cover letters

Without a key, Claude handles everything. With a free Groq key, cover letters and scoring run faster:

```bash
# workers/.env
GROQ_API_KEY=your_key_here   # free at groq.com
```

---

## Optional: Dashboard

```
/job-hunter dashboard
```

Opens a visual kanban board at `localhost:4242` showing all found/applied/interview jobs with agent activity.

---

## Agents

Each agent is a specialized prompt that Claude runs as a subagent:

| Agent | Anime | Role |
|-------|-------|------|
| Fern | Frieren | Searches job boards, classifies opportunities |
| Kaguya | Kaguya-sama | Scans X/Twitter and Reddit for hiring posts |
| Reigen | Mob Psycho | Fills ATS forms and submits applications |
| Erwin | Attack on Titan | Market analysis — what to prioritize |

You can rename agents and swap avatars by editing `dashboard/src/agents.js`.

---

## Privacy

`profile.json`, `jobs.db`, and `.env` are in `.gitignore`. Nothing personal ever gets committed.

---

## Requirements

- [Claude Code](https://claude.ai/code) (CLI or desktop app)
- Node.js 18+

Optional:
- Free [Groq API key](https://console.groq.com) for faster cover letters
- Playwright MCP in Claude settings for automatic form-filling
- Chrome with active sessions for Twitter/X scraping

---

## Support the project

If this helped you find a job, consider a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/aleaguirre)

---

## License

MIT
