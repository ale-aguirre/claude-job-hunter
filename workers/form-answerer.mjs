/**
 * form-answerer.mjs — Full ATS form relevamiento + answering (Greenhouse/Ashby/Lever/Workable)
 *
 * Root causes fixed here (confirmed live against GitLab's Greenhouse board, 2026-08-13):
 *   1. fillForm's CSS selectors relied on `name=`/`type=email` attributes. Greenhouse's
 *      job-boards React app uses `id="email"` with `type="text"` — the selector never
 *      matched, so email was silently skipped (confirmed: DOM value stayed "").
 *   2. CV upload used `input[type=file].setInputFiles()` directly. That DOES attach the
 *      file to the DOM input (files.length becomes 1), but Greenhouse's own upload
 *      handler crashes with "Cannot read properties of undefined (reading 'uploadFile')"
 *      because their state is wired up inside the visible "Attach" button's onClick, not
 *      the hidden input's change event. Fix: use the real filechooser flow (click the
 *      "Attach" button, intercept the native file-chooser event, setFiles there) — this
 *      is the flow verified to leave a clean "filename.pdf" in the DOM with zero error.
 *   3. There was no handling at all for react-select style custom comboboxes
 *      (role="combobox" input + a `react-select-<id>-listbox` or portal `[role=listbox]`
 *      with `[role=option]` children) — every required dropdown question stayed empty.
 *
 * Rule of the repo, applied here: the model classifies/chooses, the code decides.
 * Every LLM output is validated against the real DOM options before being used.
 */
import { mkdirSync } from 'fs';
import { PROFILE, CV_PATH } from './config.mjs';
import { callFast } from './anthropic-client.mjs';
import { spanTask } from './telemetry.mjs';
import { getFacts } from './cv-tailor.mjs';
import { clickSubmit, verifySubmission } from './form-utils.mjs';

// ── Constants / policy ───────────────────────────────────────────────────────
export const SALARY_ANSWER = 'USD 4000 gross monthly, flexible';

// Voluntary self-identification (EEO) — never answered by this system, ever,
// required or not. If the ATS offers a "decline to answer" option it is used;
// otherwise the field is left blank and reported as skipped-by-policy.
const EEO_LABEL_RE = /\b(gender|ethnicity|race|hispanic|latino|latinx|veteran|disability|disabled|sexual orientation|transgender|pronoun)\b/i;
const DECLINE_OPTION_RE = /decline|prefer not|don'?t wish|not to (answer|disclose|self-identify)|not disclose/i;

// Legal/visa/salary — the categories the repo owner explicitly forbids guessing on.
const SALARY_RE = /salary expectation|compensation expectation|desired salary|expected salary|salary range you.?re seeking|desired (hourly )?rate|hourly rate|pay rate|rate you.?re seeking/i;
const AUTH_RE   = /authoriz(e|ed|ation) to work in|legally (authorized|eligible) to work/i;
const SPONSOR_RE = /sponsorship/i;
const WORKED_HERE_RE = /(previously worked at|worked (for|at)|consulted for|been employed by)\b/i;
const PREFERRED_NAME_RE = /preferred name|name.*prefer.*use|chosen name/i;

const CATCHALL_OPTION_RE = /located elsewhere|rest of the world|other\b|anywhere else|not listed/i;

let _profileSummary = null;
function profileSummary() {
  if (_profileSummary) return _profileSummary;
  const facts = getFacts();
  const coreSkills = facts.skills.filter(s => s.category === 'core' || s.category === 'ai').map(s => s.label).join(', ');
  _profileSummary =
    `${facts.identity.name}, full-stack developer, 5+ years shipping production apps, ` +
    `building LLM products since 2025. Based in ${facts.identity.location}. ` +
    `Core skills: ${coreSkills}. Notable projects: ${facts.projects.slice(0, 3).map(p => p.name).join(', ')}.`;
  return _profileSummary;
}

// ── 1. Field enumeration ─────────────────────────────────────────────────────
/**
 * Tags every fillable control on the page with a stable data-fa-id and returns
 * a plain descriptor for each: label, required-ness, current fill state.
 * Radio buttons are grouped by `name` into one virtual field with options.
 */
export async function enumerateFields(page) {
  const raw = await page.evaluate(() => {
    function computeLabel(el) {
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return al.trim();
      const lb = el.getAttribute('aria-labelledby');
      if (lb) {
        const t = lb.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (t) return t;
      }
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab && lab.textContent.trim()) return lab.textContent.trim();
      }
      const wrap = el.closest('label');
      if (wrap) {
        const t = wrap.textContent.replace(el.value || '', '').trim();
        if (t) return t;
      }
      let node = el;
      for (let i = 0; i < 6 && node; i++) {
        const parent = node.parentElement;
        if (!parent) break;
        const cand = parent.querySelector(':scope > label, :scope > legend, :scope > [class*="label" i], :scope > [class*="title" i], :scope > [class*="question" i]');
        if (cand && !cand.contains(el)) {
          const t = cand.textContent.trim();
          if (t) return t;
        }
        node = parent;
      }
      return el.getAttribute('placeholder') || el.name || el.id || '';
    }
    function computeRequired(el, label) {
      if (el.required) return true;
      if (el.getAttribute('aria-required') === 'true') return true;
      if (/\*\s*$/.test(label || '')) return true;
      if (/\brequired\b/i.test(label || '')) return true;
      // Ashby (and others) render the red "*" as a CSS ::after on a label with a
      // "_required_..." class — no DOM attribute, no literal "*" text anywhere.
      // Confirmed live: Braintrust's sponsorship question and Location field both
      // looked optional by every check above and were left empty/unanswered,
      // exactly the kind of silent gap the "fail visible" rule exists to catch.
      if (/required/i.test(el.className || '')) return true;
      let node = el;
      for (let i = 0; i < 4 && node; i++) {
        const parent = node.parentElement;
        if (!parent) break;
        const marker = parent.querySelector('[class*="required" i]');
        if (marker && marker !== el) return true;
        node = parent;
      }
      return false;
    }

    let n = 0;
    const out = [];
    const radioGroups = new Map(); // name -> { label, options: [{text, checked}] }
    const checkboxGroups = new Map(); // data-field-path -> { label, fieldEntry, options: [{text, checked, el}] }

    document.querySelectorAll('input, textarea, select, [role="combobox"]').forEach(el => {
      if (el.type === 'hidden') return;
      if (el.name === 'g-recaptcha-response' || (el.id || '').includes('recaptcha')) return;
      // File inputs are handled entirely by uploadCVRobust() (real filechooser
      // flow), never by the generic field loop. Ashby renders a SECOND, decoy
      // file input for its "autofill from resume" dropzone with no id/label of
      // its own; left in, its label-fallback bubbles all the way up to the page
      // H1 and it shows up as a nonsense "required" ghost field in the report.
      if (el.type === 'file') return;

      // Greenhouse (and others) render a second, fully anonymous <input required>
      // next to every react-select combobox purely for native HTML5 validation —
      // no id/name/aria-label/placeholder of its own. Left unfiltered it inherits
      // the SAME label as the real combobox (ancestor text-scan finds the shared
      // field container) and gets "answered" as if it were a selectable control,
      // which it isn't: confirmed live, it produced a phantom duplicate entry
      // ("no matching option among: ") right under the real, correctly-filled one.
      if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(el.type)
        && !el.id && !el.name && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.placeholder
        && el.getAttribute('role') !== 'combobox') return;

      const tag = el.tagName.toLowerCase();
      const roleAttr = el.getAttribute('role');
      // role=combobox must win over el.type: Greenhouse/Ashby-style custom
      // dropdowns are a plain <input type="text" role="combobox">, and el.type
      // always reports "text" for a bare <input> — checking el.type first (as an
      // earlier version of this code did) silently misclassified every required
      // Yes/No dropdown as a free-text field, so classifyField() never routed
      // "Do you have strong proficiency in...?" etc. to the LLM at all.
      const type = roleAttr === 'combobox' ? 'combobox' : (el.type || tag);
      const label = computeLabel(el);

      if (type === 'radio') {
        const name = el.name || label;
        if (!radioGroups.has(name)) radioGroups.set(name, { label, options: [] });
        const g = radioGroups.get(name);
        const optLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim()
          || el.closest('label')?.textContent.trim()
          || el.value || '';
        g.options.push({ text: optLabel, checked: el.checked });
        g.required = g.required || computeRequired(el, label);
        return;
      }

      // Ashby renders single Yes/No questions (sponsorship, background-check
      // consent, etc.) as a hidden <input type="checkbox"> plus two sibling
      // <button>Yes</button><button>No</button> elements the checkbox never
      // reflects. Treated as a plain checkbox this got routed to the free-text
      // LLM path (label ends in "?") which tried to .fill() a checkbox with a
      // whole sentence — confirmed live on g2i's background-check question.
      // Detected here and handled like radio-group/select: pick one real option.
      if (type === 'checkbox') {
        const siblingBtns = [...(el.parentElement?.querySelectorAll(':scope > button') || [])];
        if (siblingBtns.length >= 2) {
          const fid = `fa-${n++}`;
          el.setAttribute('data-fa-id', fid);
          siblingBtns.forEach((b, bi) => b.setAttribute('data-fa-yesno', `${fid}-${bi}`));
          const selected = siblingBtns.find(b => b.getAttribute('aria-pressed') === 'true' || /selected|active|_checked/i.test(b.className));
          const required = computeRequired(el, label);
          out.push({
            fid, tag: 'input', type: 'yesno-buttons', label: label.trim(), required,
            filled: !!selected, options: siblingBtns.map(b => b.textContent.trim()),
          });
          return;
        }

        // Multi-select checkbox group (Ashby "select up to N" pattern, e.g.
        // "Preferred languages"). Every checkbox in the group has a DIFFERENT
        // name (the option text itself) but shares one ancestor with
        // data-field-path — that's the only thing tying them together.
        // Confirmed live on g2i: left ungrouped, all 20+ checkboxes were
        // individually classified "no rule matched" and the required group
        // stayed empty with no error surfaced anywhere.
        const fieldEntry = el.closest('[data-field-path]');
        const fieldPath = fieldEntry?.getAttribute('data-field-path');
        if (fieldPath) {
          if (!checkboxGroups.has(fieldPath)) {
            const heading = fieldEntry.querySelector('label, legend, [class*="label" i]');
            checkboxGroups.set(fieldPath, { label: (heading?.textContent || label).trim(), fieldEntry, headingEl: heading || fieldEntry, options: [] });
          }
          const g = checkboxGroups.get(fieldPath);
          g.options.push({ text: (el.name || label).trim(), checked: el.checked, el });
          return;
        }
      }

      const required = computeRequired(el, label);
      const isChecky = type === 'checkbox';
      const value = tag === 'select' ? el.value : (isChecky ? el.checked : el.value);
      const filled = isChecky ? !!el.checked : !!(value && String(value).trim());

      const fid = `fa-${n++}`;
      el.setAttribute('data-fa-id', fid);
      out.push({ fid, tag, type, label: label.trim(), required, filled, value: type === 'file' ? null : value });
    });

    let rn = 0;
    for (const [name, g] of radioGroups) {
      const fid = `fa-radio-${rn++}`;
      document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`).forEach(r => r.setAttribute('data-fa-radio-id', fid));
      out.push({
        fid, tag: 'input', type: 'radio-group', groupName: name,
        label: g.label.trim(), required: !!g.required,
        filled: g.options.some(o => o.checked),
        options: g.options.map(o => o.text),
      });
    }

    let cgn = 0;
    for (const [path, g] of checkboxGroups) {
      const fid = `fa-cbg-${cgn++}`;
      g.options.forEach((o, i) => o.el.setAttribute('data-fa-cbg', `${fid}-${i}`));
      out.push({
        fid, tag: 'input', type: 'checkbox-group', groupPath: path,
        label: g.label, required: computeRequired(g.headingEl, g.label),
        filled: g.options.some(o => o.checked),
        options: g.options.map(o => o.text),
      });
    }

    return out;
  });
  return raw;
}

// ── 2. Deterministic classification ──────────────────────────────────────────
/**
 * Tries to resolve a field without any LLM call. Returns:
 *   { kind: 'text', value }              — write this literal value
 *   { kind: 'option', value }            — pick this option TEXT from the real list (caller matches)
 *   { kind: 'skip' }                     — leave empty, not our business (EEO, optional accommodation, ...)
 *   { kind: 'abort', reason }            — legal question with no safe deterministic answer
 *   { kind: 'llm-option' }               — needs the LLM to choose among the field's real options
 *   { kind: 'llm-text' }                 — needs the LLM to write a short open answer
 */
export function classifyField(field, job) {
  const label = field.label || '';
  const low = label.toLowerCase();

  // EEO / voluntary self-identification — never touched.
  if (EEO_LABEL_RE.test(low)) return { kind: 'skip', reason: 'EEO/voluntary self-identification' };

  // Straight identity fields.
  if (/first\s*name/i.test(low)) return { kind: 'text', value: PROFILE.firstName };
  if (/last\s*name/i.test(low)) return { kind: 'text', value: PROFILE.lastName };
  if (PREFERRED_NAME_RE.test(low)) return { kind: 'text', value: PROFILE.firstName };
  if (/^name$/i.test(low.trim())) return { kind: 'text', value: `${PROFILE.firstName} ${PROFILE.lastName}` };
  if (/e-?mail/i.test(low)) return PROFILE.email ? { kind: 'text', value: PROFILE.email } : { kind: 'skip', reason: 'no email in profile' };
  if (/phone/i.test(low)) return PROFILE.phone ? { kind: 'text', value: PROFILE.phone } : { kind: 'skip', reason: 'no phone in profile — not configured in .env' };
  if (/linkedin/i.test(low)) return PROFILE.linkedin ? { kind: 'text', value: PROFILE.linkedin } : { kind: 'skip', reason: 'no linkedin in profile' };
  if (/github/i.test(low)) return PROFILE.github ? { kind: 'text', value: PROFILE.github } : { kind: 'skip', reason: 'no github in profile' };
  if (/portfolio|personal website/i.test(low)) return PROFILE.portfolio ? { kind: 'text', value: PROFILE.portfolio } : { kind: 'skip', reason: 'no portfolio in profile' };
  if (/^city$/i.test(low.trim())) return PROFILE.city ? { kind: 'text', value: PROFILE.city } : { kind: 'skip', reason: 'no city in profile' };

  // "How did you hear about us" — deterministic per repo rules.
  if (/how did you (hear|find out|come across)/i.test(low)) return { kind: 'option', value: 'LinkedIn', fallback: 'Job board' };

  // Country / location questions. Ashby's system location field is literally
  // just labelled "Location" — confirmed live on Braintrust/g2i, both required.
  if (/country of residence|located in|country\b.*located|which country|currently based|^location$/i.test(low.trim())) {
    return { kind: 'option', value: 'Argentina', fallback: CATCHALL_OPTION_RE };
  }

  // "Have you worked at / consulted for <company>" — truthful deterministic No,
  // company is never in cv-facts.experience.
  if (WORKED_HERE_RE.test(low) && job?.company && low.includes(job.company.toLowerCase().split(' ')[0])) {
    return { kind: 'option', value: 'No' };
  }

  // Salary — the one number the repo owner defined.
  if (SALARY_RE.test(low)) return { kind: 'text', value: SALARY_ANSWER, optionFallback: SALARY_ANSWER };

  // Sponsorship — "NO adivinar" unless it clearly resolves to Argentina (candidate's
  // own declared residence). Any other named country → abort, human decides.
  if (SPONSOR_RE.test(low)) {
    const namesOtherCountry = /\b(united states|u\.?s\.?a?\.?|uk|united kingdom|canada|australia|germany|netherlands|ireland|europe|eu\b)\b/i.test(low);
    if (namesOtherCountry) return { kind: 'abort', reason: `requiere respuesta humana: ${label}` };
    // "current location" / "your country" / no country named → resolves to Argentina.
    return { kind: 'option', value: 'No' };
  }

  // Work authorization — only answerable when explicitly about Argentina.
  if (AUTH_RE.test(low)) {
    if (/argentina/i.test(low)) return { kind: 'option', value: 'Yes' };
    return { kind: 'abort', reason: `requiere respuesta humana: ${label}` };
  }

  // Multi-select checkbox group ("select up to N languages/skills/etc") —
  // needs a different LLM shape (pick several, not one).
  if (field.type === 'checkbox-group') return { kind: 'llm-multi-option' };

  // Anything else that is a real dropdown/combobox/radio-group/yes-no-toggle
  // with concrete options: let the LLM choose among the REAL options
  // (validated by caller).
  if (['combobox', 'select', 'radio-group', 'yesno-buttons'].includes(field.type)) {
    return { kind: 'llm-option' };
  }

  // Open text question long enough to look like a real prompt.
  if (field.tag === 'textarea' || /\?\s*$/.test(label)) {
    return { kind: 'llm-text' };
  }

  return { kind: 'skip', reason: 'no rule matched, not a select/textarea' };
}

// ── 3. LLM: choose among real options ────────────────────────────────────────
export async function llmChooseOption(question, options, job) {
  return spanTask('llm_choose_option', { 'form.question': question.slice(0, 80) }, async () => {
    const system = 'You fill out a job application form. Given a question and a numbered list of the REAL options present in the form, reply with ONLY the number of the best-fitting option. Never invent a number outside the list. If genuinely nothing fits, reply 0.';
    const user = `Candidate profile: ${profileSummary()}\n\nJob: ${job?.title || ''} at ${job?.company || ''}\n\nQuestion: ${question}\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nReply with only the number.`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // gpt-oss on Groq "thinks" before answering and the thinking is billed
        // against max_tokens (see anthropic-client.mjs) — 20 was too tight and
        // truncated the reply to nothing on the first live run. 80 leaves room.
        const raw = await callFast(system, user, 80);
        const n = parseInt((raw.match(/\d+/) || [])[0], 10);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return { index: n - 1, text: options[n - 1] };
        if (n === 0) return { index: -1, text: null };
      } catch (e) {
        console.warn(`[form-answerer] llmChooseOption attempt ${attempt} failed: ${e.message.slice(0, 80)}`);
      }
    }
    return { index: -1, text: null };
  });
}

// ── 3b. LLM: choose several among real options (multi-select checkbox groups) ─
export async function llmChooseMultipleOptions(question, options, job, maxPick = 5) {
  return spanTask('llm_choose_multi_option', { 'form.question': question.slice(0, 80) }, async () => {
    const system = `You fill out a job application form. Given a question and a numbered list of the REAL options present in the form, reply with ONLY a comma-separated list of the numbers that best fit (at most ${maxPick}). Never invent a number outside the list. If genuinely nothing fits, reply 0.`;
    const user = `Candidate profile: ${profileSummary()}\n\nJob: ${job?.title || ''} at ${job?.company || ''}\n\nQuestion: ${question}\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nReply with only the numbers, comma-separated.`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Wider than the single-choice call: these prompts list many more
        // options (e.g. 24 languages), so gpt-oss's pre-answer "thinking"
        // tokens (billed against max_tokens, see anthropic-client.mjs) need
        // more room — 80 truncated to nothing on g2i's language checklist.
        const raw = await callFast(system, user, 150);
        if (/^\s*0\s*$/.test(raw.trim())) return [];
        const nums = [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10)).filter(n => n >= 1 && n <= options.length);
        const uniq = [...new Set(nums)].slice(0, maxPick);
        if (uniq.length) return uniq.map(n => n - 1);
      } catch (e) {
        console.warn(`[form-answerer] llmChooseMultipleOptions attempt ${attempt} failed: ${e.message.slice(0, 80)}`);
      }
    }
    return [];
  });
}

// ── 4. LLM: short open answer grounded in cv-facts ───────────────────────────
export async function llmShortAnswer(question, job) {
  return spanTask('llm_short_answer', { 'form.question': question.slice(0, 80) }, async () => {
    const facts = getFacts();
    const bulletPool = facts.experience.flatMap(e => e.bullets.map(b => b.en)).concat(
      facts.projects.flatMap(p => p.bullets.map(b => b.en))
    ).join('\n- ');
    const system = 'You answer a single job-application question honestly, using ONLY the facts provided. Never invent experience, employers, metrics or technologies not listed. 2-3 sentences, plain prose, max 380 characters. If the facts genuinely do not support an honest answer, reply exactly: NO_ANSWER.';
    const user = `Job: ${job?.title || ''} at ${job?.company || ''}\n\nQuestion: ${question}\n\nCandidate facts (only use these):\n${facts.summary_base.en}\n- ${bulletPool}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = (await callFast(system, user, 220)).trim();
        if (!raw || /^NO_ANSWER$/i.test(raw)) return null;
        return raw.slice(0, 400);
      } catch (e) {
        console.warn(`[form-answerer] llmShortAnswer attempt ${attempt} failed: ${e.message.slice(0, 80)}`);
      }
    }
    return null;
  });
}

// ── 5. DOM setters ────────────────────────────────────────────────────────────
async function setTextLike(page, fid, value) {
  const sel = `[data-fa-id="${fid}"]`;
  try {
    await page.click(sel, { timeout: 3000 }).catch(() => {});
    await page.fill(sel, '', { timeout: 3000 }).catch(() => {});
    await page.fill(sel, value, { timeout: 3000 });
    return true;
  } catch {
    try { await page.locator(sel).pressSequentially(value, { delay: 5 }); return true; } catch { return false; }
  }
}

async function readOpenListbox(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return [];
    const controls = el.getAttribute('aria-controls');
    let listbox = controls ? document.getElementById(controls) : null;
    if (!listbox && el.id) listbox = document.getElementById(`react-select-${el.id}-listbox`);
    if (!listbox) listbox = [...document.querySelectorAll('[role="listbox"]')].find(l => !!l.offsetParent);
    if (!listbox) return [];
    const opts = [...listbox.querySelectorAll('[role="option"]')].filter(o => !!o.offsetParent);
    opts.forEach((o, i) => o.setAttribute('data-fa-opt', `${sel.replace(/[^a-z0-9]/gi, '')}-${i}`));
    return opts.map((o, i) => ({ idx: i, text: o.textContent.replace(/^\d+\.\s*/, '').trim(), optSel: `[data-fa-opt="${sel.replace(/[^a-z0-9]/gi, '')}-${i}"]` }));
  }, sel);
}

/**
 * Opens a combobox and reads its options. Some ATS (Ashby's "Location" field,
 * backed by a worldwide city list) render ZERO options until the user types —
 * confirmed live: clicking alone left both Braintrust's and g2i's Location
 * field with "no options found in DOM". If typeHint is given and the initial
 * open comes back empty, types it in as a search filter and re-reads.
 */
async function getComboboxOptions(page, fid, typeHint) {
  const sel = `[data-fa-id="${fid}"]`;
  // The LLM path opens the dropdown once to list options for the prompt, then
  // opens it again (fresh option refs) to click the chosen one. React-select
  // TOGGLES on click, so the second call closed a menu the first had already
  // opened and every LLM-picked option failed to click — confirmed live, all
  // three Yes/No skill questions came back "chose an option but click failed".
  // Escape first so every call starts from a known-closed state.
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await page.click(sel, { timeout: 3000 });
  } catch { return []; }
  await page.waitForTimeout(200);
  let opts = await readOpenListbox(page, sel);
  if (!opts.length && typeHint) {
    try { await page.locator(sel).pressSequentially(typeHint, { delay: 15 }); } catch {}
    await page.waitForTimeout(500);
    opts = await readOpenListbox(page, sel);
  }
  return opts;
}

async function setCombobox(page, fid, desiredText) {
  const opts = await getComboboxOptions(page, fid, desiredText);
  if (!opts.length) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, options: [] }; }
  const norm = s => (s || '').toLowerCase().trim();
  let match = opts.find(o => norm(o.text) === norm(desiredText));
  if (!match) match = opts.find(o => norm(o.text).includes(norm(desiredText)));
  if (!match) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, options: opts.map(o => o.text) }; }
  try { await page.click(match.optSel, { timeout: 3000 }); return { ok: true, options: opts.map(o => o.text), picked: match.text }; }
  catch { return { ok: false, options: opts.map(o => o.text) }; }
}

async function setComboboxByIndex(page, fid, idx) {
  const opts = await getComboboxOptions(page, fid);
  if (idx < 0 || idx >= opts.length) { await page.keyboard.press('Escape').catch(() => {}); return { ok: false, options: opts.map(o => o.text) }; }
  try { await page.click(opts[idx].optSel, { timeout: 3000 }); return { ok: true, picked: opts[idx].text, options: opts.map(o => o.text) }; }
  catch { return { ok: false, options: opts.map(o => o.text) }; }
}

async function setNativeSelect(page, fid, desiredText) {
  const sel = `[data-fa-id="${fid}"]`;
  const options = await page.$$eval(`${sel} option`, els => els.map(o => o.textContent.trim())).catch(() => []);
  const norm = s => (s || '').toLowerCase().trim();
  let target = options.find(o => norm(o) === norm(desiredText)) || options.find(o => norm(o).includes(norm(desiredText)));
  if (!target) return { ok: false, options };
  try { await page.selectOption(sel, { label: target }); return { ok: true, picked: target, options }; }
  catch { return { ok: false, options }; }
}

async function setRadioGroup(page, fid, desiredText) {
  const sel = `[data-fa-radio-id="${fid}"]`;
  const norm = s => (s || '').toLowerCase().trim();
  return page.evaluate(({ sel, desiredText }) => {
    const norm = s => (s || '').toLowerCase().trim();
    const radios = [...document.querySelectorAll(sel)];
    const labelOf = r => (document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent
      || r.closest('label')?.textContent || r.value || '').trim();
    let target = radios.find(r => norm(labelOf(r)) === norm(desiredText));
    if (!target) target = radios.find(r => norm(labelOf(r)).includes(norm(desiredText)));
    if (!target) return { ok: false, options: radios.map(labelOf) };
    target.click();
    return { ok: true, picked: labelOf(target), options: radios.map(labelOf) };
  }, { sel, desiredText });
}

async function setYesNoButtons(page, fid, desiredText) {
  const norm = s => (s || '').toLowerCase().trim();
  const opts = await page.$$eval(`[data-fa-yesno^="${fid}-"]`, els => els.map(e => e.textContent.trim())).catch(() => []);
  const idx = opts.findIndex(o => norm(o) === norm(desiredText));
  if (idx < 0) return { ok: false, options: opts };
  try { await page.click(`[data-fa-yesno="${fid}-${idx}"]`, { timeout: 3000 }); return { ok: true, picked: opts[idx], options: opts }; }
  catch { return { ok: false, options: opts }; }
}

async function setCheckboxGroup(page, fid, indices) {
  let clicked = 0;
  for (const idx of indices) {
    try { await page.click(`[data-fa-cbg="${fid}-${idx}"]`, { timeout: 3000 }); clicked++; } catch { /* keep going, report partial */ }
  }
  return { ok: clicked > 0, clicked };
}

// ── 6. CV upload — the actual fix ────────────────────────────────────────────
/**
 * Uploads the CV through the real filechooser flow. Greenhouse-style forms wire
 * their upload state to the visible "Attach"/"Upload" button's onClick handler;
 * setting the hidden <input type=file> directly attaches the file at the DOM
 * level but leaves the ATS's own JS in a broken state ("Cannot read properties
 * of undefined (reading 'uploadFile')"), so no filename ever appears and the
 * field stays red. This clicks the button, intercepts the native chooser, and
 * only falls back to setInputFiles for ATS that don't wire a button at all.
 */
export async function uploadCVRobust(page, cvPath) {
  return spanTask('upload_cv', {}, async () => {
    const fileInputs = await page.$$('input[type="file"]');
    if (!fileInputs.length) return { ok: false, reason: 'no file input on page' };

    // Prefer the input whose label mentions resume/cv; else the first required one.
    let target = null;
    for (const fi of fileInputs) {
      const label = await fi.evaluate(el => {
        const id = el.id;
        const lab = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrapLabel = document.getElementById(`upload-label-${id}`);
        return (wrapLabel?.textContent || lab?.textContent || '').toLowerCase();
      });
      if (/resume|cv|curriculum/.test(label)) { target = fi; break; }
    }
    if (!target) target = fileInputs[0];

    const fid = await target.evaluate(el => { el.setAttribute('data-fa-cv', '1'); return el.id || null; });

    // 1. Try the real click -> filechooser flow via a nearby visible button.
    const btnSel = `[data-fa-cv="1"]`;
    let usedFileChooser = false;
    try {
      const clickable = await page.evaluateHandle((sel) => {
        const input = document.querySelector(sel);
        const group = input.closest('[role="group"], div');
        const btn = group?.querySelector('button, label[for]') || input;
        return btn === input ? null : btn;
      }, btnSel);
      const btnEl = clickable.asElement();
      if (btnEl) {
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 4000 }),
          btnEl.click(),
        ]);
        await chooser.setFiles(cvPath);
        usedFileChooser = true;
      }
      await clickable.dispose();
    } catch { /* fall through to direct setInputFiles */ }

    if (!usedFileChooser) {
      try { await target.setInputFiles(cvPath); } catch (e) { return { ok: false, reason: `setInputFiles threw: ${e.message.slice(0, 100)}` }; }
    }

    // Verify: the filename must show up in the DOM. Greenhouse's upload endpoint
    // is occasionally slow enough that a fixed ~1s wait catches it mid-flight and
    // reports the (still forming) error banner — confirmed flaky live: the exact
    // same page+file succeeded on one run and failed on the next with a fixed
    // wait. Poll instead of a single fixed sleep.
    const filename = cvPath.split(/[\\/]/).pop();
    const checkVerified = () => page.evaluate((filename) => {
      const text = document.body.innerText;
      return text.includes(filename) || text.includes(filename.replace(/\.pdf$/i, ''));
    }, filename);

    let verified = false;
    for (let i = 0; i < 15 && !verified; i++) { // up to ~6s
      await page.waitForTimeout(400);
      verified = await checkVerified().catch(() => false);
    }

    if (!verified && !usedFileChooser) {
      // Only retryable path: direct setInputFiles gets no second chance (there's
      // nothing left to click); filechooser flow gets one clean retry below.
    } else if (!verified && usedFileChooser) {
      // One retry of the whole click -> filechooser -> setFiles flow.
      try {
        const clickable2 = await page.evaluateHandle((sel) => {
          const input = document.querySelector(sel);
          const group = input.closest('[role="group"], div');
          return group?.querySelector('button, label[for]') || null;
        }, btnSel);
        const btnEl2 = clickable2.asElement();
        if (btnEl2) {
          const [chooser2] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 4000 }),
            btnEl2.click(),
          ]);
          await chooser2.setFiles(cvPath);
        }
        await clickable2.dispose();
      } catch { /* fall through to final check */ }
      for (let i = 0; i < 10 && !verified; i++) {
        await page.waitForTimeout(400);
        verified = await checkVerified().catch(() => false);
      }
    }

    if (!verified) {
      const errText = fid ? await page.evaluate((fid) => document.getElementById(`${fid}-error`)?.textContent || null, fid) : null;
      return { ok: false, reason: errText ? `ATS upload error: ${errText.trim()}` : 'filename not visible in DOM after upload', usedFileChooser };
    }
    return { ok: true, filename, usedFileChooser };
  });
}

// ── 7. Orchestrator ──────────────────────────────────────────────────────────
/**
 * Fills every required, currently-empty field on the page.
 * Returns { report: [...], aborted: string|null }
 * report entries: { label, required, method: 'deterministic'|'llm'|'skip'|'unanswerable', value, note }
 */
export async function fillAllRequiredFields(page, job) {
  const fields = await enumerateFields(page);
  const report = [];
  let llmCalls = 0;

  for (const field of fields) {
    if (field.filled) { report.push({ label: field.label, required: field.required, method: 'already-filled', value: field.value }); continue; }
    if (!field.required) { report.push({ label: field.label, required: false, method: 'skip', note: 'optional' }); continue; }

    const cls = classifyField(field, job);

    if (cls.kind === 'skip') {
      report.push({ label: field.label, required: true, method: 'skip', note: cls.reason });
      continue;
    }
    if (cls.kind === 'abort') {
      return { report: [...report, { label: field.label, required: true, method: 'abort', note: cls.reason }], aborted: cls.reason };
    }

    if (cls.kind === 'text') {
      const ok = await setTextLike(page, field.fid, cls.value);
      report.push({ label: field.label, required: true, method: 'deterministic', value: cls.value, note: ok ? null : 'fill() failed' });
      continue;
    }

    if (cls.kind === 'option') {
      let result;
      if (field.type === 'select') result = await setNativeSelect(page, field.fid, cls.value);
      else if (field.type === 'radio-group') result = await setRadioGroup(page, field.fid, cls.value);
      else if (field.type === 'yesno-buttons') result = await setYesNoButtons(page, field.fid, cls.value);
      else result = await setCombobox(page, field.fid, cls.value);

      if (!result.ok && cls.fallback) {
        const fallbackText = typeof cls.fallback === 'string'
          ? cls.fallback
          : (result.options || []).find(o => cls.fallback.test(o));
        if (fallbackText) {
          result = field.type === 'select' ? await setNativeSelect(page, field.fid, fallbackText)
            : field.type === 'radio-group' ? await setRadioGroup(page, field.fid, fallbackText)
            : field.type === 'yesno-buttons' ? await setYesNoButtons(page, field.fid, fallbackText)
            : await setCombobox(page, field.fid, fallbackText);
        }
      }
      if (result.ok) {
        report.push({ label: field.label, required: true, method: 'deterministic', value: result.picked || cls.value });
      } else {
        report.push({ label: field.label, required: true, method: 'unanswerable', note: `no matching option among: ${(result.options || []).slice(0, 8).join(' | ')}` });
      }
      continue;
    }

    if (cls.kind === 'llm-option') {
      let options;
      if (field.type === 'select') options = await page.$$eval(`[data-fa-id="${field.fid}"] option`, els => els.map(o => o.textContent.trim())).catch(() => []);
      else if (field.type === 'radio-group' || field.type === 'yesno-buttons') options = field.options || [];
      else options = (await getComboboxOptions(page, field.fid)).map(o => o.text);

      if (!options.length) { report.push({ label: field.label, required: true, method: 'unanswerable', note: 'no options found in DOM' }); continue; }

      llmCalls++;
      const choice = await llmChooseOption(field.label, options, job);
      if (choice.index < 0) { report.push({ label: field.label, required: true, method: 'unanswerable', note: `LLM found no fit among: ${options.slice(0, 8).join(' | ')}` }); continue; }

      let result;
      if (field.type === 'select') result = await setNativeSelect(page, field.fid, choice.text);
      else if (field.type === 'radio-group') result = await setRadioGroup(page, field.fid, choice.text);
      else if (field.type === 'yesno-buttons') result = await setYesNoButtons(page, field.fid, choice.text);
      else result = await setComboboxByIndex(page, field.fid, choice.index);

      report.push(result.ok
        ? { label: field.label, required: true, method: 'llm', value: choice.text }
        : { label: field.label, required: true, method: 'unanswerable', note: 'LLM chose an option but the click to set it failed' });
      continue;
    }

    if (cls.kind === 'llm-text') {
      llmCalls++;
      const answer = await llmShortAnswer(field.label, job);
      if (!answer) { report.push({ label: field.label, required: true, method: 'unanswerable', note: 'LLM had no grounded answer in cv-facts' }); continue; }
      const ok = await setTextLike(page, field.fid, answer);
      report.push({ label: field.label, required: true, method: ok ? 'llm' : 'unanswerable', value: ok ? answer : undefined, note: ok ? null : 'fill() failed' });
      continue;
    }

    if (cls.kind === 'llm-multi-option') {
      const options = field.options || [];
      if (!options.length) { report.push({ label: field.label, required: true, method: 'unanswerable', note: 'no options found in DOM' }); continue; }

      llmCalls++;
      const indices = await llmChooseMultipleOptions(field.label, options, job);
      if (!indices.length) { report.push({ label: field.label, required: true, method: 'unanswerable', note: `LLM found no fit among: ${options.slice(0, 8).join(' | ')}` }); continue; }

      const result = await setCheckboxGroup(page, field.fid, indices);
      report.push(result.ok
        ? { label: field.label, required: true, method: 'llm', value: indices.map(i => options[i]).join(', ') }
        : { label: field.label, required: true, method: 'unanswerable', note: 'LLM chose options but clicking them failed' });
      continue;
    }

    report.push({ label: field.label, required: true, method: 'unanswerable', note: 'unclassified field type' });
  }

  return { report, aborted: null, llmCalls };
}

// ── 8. Post-submit error scan ────────────────────────────────────────────────
/**
 * Reads which required fields the ATS itself is flagging as invalid right now
 * (aria-invalid="true", or a visible error message tied to the field). Used
 * both by the retry loop and by --fill-check's "cero campos en rojo" check.
 */
export async function scanFieldErrors(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[aria-invalid="true"]').forEach(el => {
      if (!el.offsetParent && el.type !== 'hidden') { /* still report — some ATS keep the combobox input 0-height */ }
      const errId = el.getAttribute('aria-errormessage') || el.getAttribute('aria-describedby');
      const errText = errId ? (errId.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim()) : '';
      const lb = el.getAttribute('aria-labelledby');
      const label = lb
        ? lb.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim()
        : (el.getAttribute('aria-label') || el.name || el.id || '');
      out.push({ label: label.trim(), error: errText || 'marked invalid' });
    });
    // Fallback: scan for the literal "required" text pattern next to unfilled inputs,
    // for ATS that don't set aria-invalid at all.
    document.querySelectorAll('.helper-text--error, [class*="error" i]').forEach(el => {
      const t = el.textContent.trim();
      if (t && /required|is missing|please/i.test(t) && t.length < 200) {
        out.push({ label: null, error: t });
      }
    });
    return out;
  });
}

// ── 9. Submit with one retry on validation errors ────────────────────────────
/**
 * clickSubmit() -> verifySubmission(). If the ATS bounced the submission with
 * red fields, re-runs fillAllRequiredFields once (the DOM re-renders error
 * state but the same fields/options are still there) and retries submit once.
 * Never called with a real submit unless the caller explicitly wants LIVE.
 */
export async function submitWithRetry(page, job) {
  const clicked = await clickSubmit(page);
  if (!clicked) return { status: 'blocked', reason: 'no submit button found', fieldErrors: [] };

  let proof = await verifySubmission(page, { company: job.company, originalUrl: job.url });
  if (proof.confirmed) return { status: 'applied', proof };

  let fieldErrors = await scanFieldErrors(page);
  if (fieldErrors.length === 0) return { status: 'blocked', reason: 'submit did not confirm and no red fields found — unverified', proof, fieldErrors };

  // One repair pass.
  const retryFill = await fillAllRequiredFields(page, job);
  if (retryFill.aborted) return { status: 'blocked', reason: retryFill.aborted, fieldErrors };

  const clicked2 = await clickSubmit(page);
  if (!clicked2) return { status: 'blocked', reason: 'no submit button on retry', fieldErrors };
  proof = await verifySubmission(page, { company: job.company, originalUrl: job.url });
  if (proof.confirmed) return { status: 'applied', proof, retried: true };

  fieldErrors = await scanFieldErrors(page);
  return { status: 'blocked', reason: `still failing after retry — ${fieldErrors.length} field(s) in error`, proof, fieldErrors };
}

// ── 10. --fill-check: fill everything, screenshot, never submit ─────────────
export async function runFillCheck(page, job, outDir = 'C:/tmp') {
  mkdirSync(outDir, { recursive: true });
  const cv = await uploadCVRobust(page, CV_PATH);
  const fillResult = await fillAllRequiredFields(page, job);
  await page.waitForTimeout(500);

  const errors = await scanFieldErrors(page);
  const ts = Date.now();
  const safeCompany = (job.company || 'unknown').replace(/[^a-z0-9]/gi, '_').slice(0, 30);
  const screenshotPath = `${outDir}/fillcheck_${safeCompany}_${ts}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  return {
    screenshotPath,
    cv,
    aborted: fillResult.aborted,
    report: fillResult.report,
    llmCalls: fillResult.llmCalls || 0,
    fieldErrorsAfterFill: errors,
  };
}
