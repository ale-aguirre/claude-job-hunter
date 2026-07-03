/**
 * templates.mjs — Shared email building helpers
 * Exports: CV_MAP, cvFor, detectRole, detectLang, cleanTitle, buildEmail
 * Used by draft.mjs and email-apply.mjs — no LLM, no side effects beyond dotenv
 */
import 'dotenv/config';

export const CV_DIR    = process.env.CV_DIR;
export const PORTFOLIO = process.env.PORTFOLIO;
export const GITHUB    = process.env.GITHUB;

export const CV_MAP = {
  ai:        { en: 'Alexis_Aguirre_CV_AI.pdf', es: 'Alexis_Aguirre_CV_AI_ES.pdf' },
  fullstack: { en: 'Alexis_Aguirre_CV.pdf',    es: 'Alexis_Aguirre_CV_ES.pdf'    },
  frontend:  { en: 'Alexis_Aguirre_CV.pdf',    es: 'Alexis_Aguirre_CV_ES.pdf'    },
};

export function cvFor(role, lang) {
  if (!CV_DIR) {
    console.error('[templates] CV_DIR not set in .env — aborting');
    process.exit(1);
  }
  const name = CV_MAP[role]?.[lang] || CV_MAP.fullstack.en;
  return `${CV_DIR}/${name}`;
}

export function detectRole(job) {
  const t = `${job.title} ${job.notes}`.toLowerCase();
  if (/\b(ai|llm|agent|agentic|anthropic|claude|openai|ml engineer|prompt)\b/.test(t)) return 'ai';
  if (/\b(front[\s-]?end|ui engineer|ui developer|react developer)\b/.test(t) && !/full[\s-]?stack/.test(t)) return 'frontend';
  return 'fullstack';
}

export function detectLang(job) {
  const t = `${job.title} ${job.notes}`.toLowerCase();
  const esHits = (t.match(/\b(desarrollador|remoto|empresa|experiencia|buscamos|requisitos|conocimientos|equipo|puesto|vacante)\b/g) || []).length;
  return esHits >= 2 ? 'es' : 'en';
}

export function cleanTitle(raw) {
  return (raw || 'the role')
    .split('|')[0]
    .split(' - ')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70) || 'the role';
}

// Templates — deterministic, quality baked in, no generation at send time
const T = {
  ai: {
    en: (c, title) => ({
      subject: `Application for ${title}`,
      body: `Hi,

I saw your ${title} opening. The last year of my work has been almost entirely AI agents in production, so it caught my eye.

The clearest example: I built claude-job-hunter, an autonomous agent that scrapes job boards, scores each role against a profile, writes the application, and sends it with no human in the loop. It runs on Claude API, an MCP tool layer, and Playwright. It's public on my GitHub.

Alongside that I built SKUscribe, an AI SaaS that generates e-commerce listings (Next.js + Supabase + Claude), and Agent Arena, a multi-agent system making decisions in real time.

Stack: TypeScript, Next.js, Node.js, Claude API, MCP, Playwright. Five years full-stack, remote from Argentina.

Alexis`,
    }),
    es: (c, title) => ({
      subject: `Application for ${title}`,
      body: `Hola,

Vi la búsqueda de ${title}. El último año trabajé casi exclusivamente en agentes de IA en producción, así que me interesó.

El ejemplo más claro: construí claude-job-hunter, un agente autónomo que rastrea portales de empleo, evalúa cada puesto contra un perfil, escribe la postulación y la envía, sin intervención humana. Corre sobre Claude API, una capa de tools MCP y Playwright. Está público en mi GitHub.

También hice SKUscribe, un SaaS de IA que genera listings de e-commerce (Next.js + Supabase + Claude), y Agent Arena, un sistema multi-agente que toma decisiones en tiempo real.

Stack: TypeScript, Next.js, Node.js, Claude API, MCP, Playwright. Cinco años full-stack, remoto desde Argentina.

Alexis`,
    }),
  },
  fullstack: {
    en: (c, title) => ({
      subject: `Application for ${title}`,
      body: `Hi,

I'm a full-stack developer with five years of experience, writing to apply for your ${title} role.

Recent work: FitDúo, a full-stack fitness app (Next.js + Neon Postgres, custom auth, push notifications) I built and shipped solo; and my current job at Contenidos Digitales, where I work on production apps with GraphQL, Apollo and Strapi for clients like Spotify, Mastercard and Visa.

I also build with AI. I made an autonomous agent that handles job applications end to end using the Claude API.

Stack: TypeScript, React, Next.js, Node.js, PostgreSQL, GraphQL. Remote from Argentina.

Alexis`,
    }),
    es: (c, title) => ({
      subject: `Application for ${title}`,
      body: `Hola,

Soy desarrollador full-stack con cinco años de experiencia y escribo para postularme a ${title}.

Trabajo reciente: FitDúo, una app fitness full-stack (Next.js + Neon Postgres, auth propia, push notifications) que construí y lancé solo; y mi trabajo actual en Contenidos Digitales, donde desarrollo apps en producción con GraphQL, Apollo y Strapi para clientes como Spotify, Mastercard y Visa.

También trabajo con IA: hice un agente autónomo que gestiona postulaciones de punta a punta usando la Claude API.

Stack: TypeScript, React, Next.js, Node.js, PostgreSQL, GraphQL. Remoto desde Argentina.

Alexis`,
    }),
  },
  frontend: {
    en: (c, title) => ({
      subject: `Application for ${title}`,
      body: `Hi,

I'm a front-end developer with five years of experience, applying for your ${title} role.

At Contenidos Digitales I build production interfaces for clients like Spotify, Mastercard, Visa and Seat, using React, Next.js and TypeScript, with a strong focus on responsive, accessible UI. On the side I built SKUscribe, an AI SaaS where I designed and shipped the full front end myself.

I care about interfaces that feel fast and deliberate, not generic.

Stack: React, Next.js, TypeScript, Tailwind, Framer Motion. Remote from Argentina.

Alexis`,
    }),
    es: (c, title) => ({
      subject: `Application for ${title}`,
      body: `Hola,

Soy desarrollador front-end con cinco años de experiencia y me postulo a ${title}.

En Contenidos Digitales construyo interfaces en producción para clientes como Spotify, Mastercard, Visa y Seat, con React, Next.js y TypeScript, enfocado en UI responsive y accesible. Aparte construí SKUscribe, un SaaS de IA donde diseñé y desarrollé todo el front-end.

Me importan las interfaces que se sienten rápidas y cuidadas, no genéricas.

Stack: React, Next.js, TypeScript, Tailwind, Framer Motion. Remoto desde Argentina.

Alexis`,
    }),
  },
};

/**
 * Build email content from a job record.
 * @returns {{ subject: string, body: string, role: string, lang: string }}
 */
export function buildEmail(job) {
  const role    = detectRole(job);
  const lang    = detectLang(job);
  const company = job.company || 'your team';
  const title   = cleanTitle(job.title);
  const { subject, body } = T[role][lang](company, title);
  const links = `\nPortfolio: ${PORTFOLIO || ''}\nGitHub: ${GITHUB || ''}`;
  return { subject, body: body + '\n' + links, role, lang };
}
