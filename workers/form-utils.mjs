/**
 * form-utils.mjs — Shared Playwright form helpers: fill, upload CV, submit, click apply
 */
import { PROFILE, CV_PATH } from './config.mjs';

/** Selectors tried (in order) to find a submit/apply button */
export const SUBMIT_SELECTORS = [
  '#submit_app',                          // Greenhouse standard
  'input[value="Submit Application"]',    // Greenhouse fallback
  'input[value="Submit application"]',
  'input[value*="Submit"]',
  'button[type="submit"]', 'input[type="submit"]',
  'button:text("Submit")', 'button:text("Apply")', 'button:text("Send application")',
  'button:text("Submit application")', 'button:text("Submit Application")',
  'button:text("Send")', 'button:text("Apply now")', 'button:text("Apply Now")',
  'button:text("Postular")', 'button:text("Enviar")', 'button:text("Enviar candidatura")',
  'button:has-text("Submit")', 'button:has-text("Apply")',
  '[data-submit="true"]', '[data-testid*="submit"]', '[data-qa*="submit"]',
];

/** Selectors tried to find an "Apply" CTA that leads to a form */
export const APPLY_LINK_SELECTORS = [
  'a:text("Apply")', 'button:text("Apply")',
  'a:text("Apply Now")', 'button:text("Apply Now")',
  'a:text("Apply for this job")', 'a:text("Apply for this role")',
  'button:text("Apply for this job")', 'button:text("Apply for this role")',
  'a[href*="/apply"]', 'a[href*="apply?"]', 'a[href*="/apply/"]',
  'a:text("Postular")', 'button:text("Postular")',
  'a:has-text("Apply")', 'button:has-text("Apply")',
  'a:has-text("Postular")', 'a[href*="postular"]',
  '[data-automation-id*="apply"]', '[data-qa*="apply"]',
];

/**
 * Fill standard job application form fields on the current page.
 * Silently skips fields that don't exist.
 * @param {import('playwright').Page} page
 * @param {string} coverLetter
 */
export async function fillForm(page, coverLetter) {
  const fill = async (sel, val) => {
    if (!val) return;
    try { await page.fill(sel, val); } catch {}
  };

  await fill('input[name="first_name"], input[name="firstName"], input[id*="first"], input[placeholder*="First name"], input[placeholder*="First Name"]', PROFILE.firstName);
  await fill('input[name="last_name"],  input[name="lastName"],  input[id*="last"],  input[placeholder*="Last name"],  input[placeholder*="Last Name"]',  PROFILE.lastName);
  await fill('input[type="email"], input[name="email"]', PROFILE.email);
  await fill('input[name="phone"], input[type="tel"]',   PROFILE.phone);
  await fill('input[name="linkedin"], input[name="linkedin_profile"], input[placeholder*="LinkedIn"]', PROFILE.linkedin);
  await fill('input[name="github"],   input[placeholder*="GitHub"],  input[placeholder*="Github"]',   PROFILE.github);
  await fill('input[name="portfolio"], input[name="website"], input[placeholder*="portfolio"], input[placeholder*="Portfolio"], input[placeholder*="Website"]', PROFILE.portfolio);
  await fill('input[name="city"], input[name="location"], input[placeholder*="City"], input[placeholder*="Location"]', PROFILE.city);
  await fill('textarea[name="cover_letter"], textarea[placeholder*="cover"], textarea[placeholder*="Cover"], textarea[name="message"], textarea[name="motivation"]', coverLetter);
}

/**
 * Upload CV to any file input on the page. Silently skips if none found.
 * @param {import('playwright').Page} page
 */
export async function uploadCV(page) {
  try {
    const fi = await page.$('input[type="file"]');
    if (fi) await fi.setInputFiles(CV_PATH);
  } catch {}
}

/**
 * Click the first matching submit button found.
 * Returns true if clicked.
 * @param {import('playwright').Page} page
 */
export async function clickSubmit(page) {
  // Wait a beat for React/form validation to enable the submit button
  await page.waitForTimeout(800).catch(() => {});
  for (const sel of SUBMIT_SELECTORS) {
    try {
      const btn = await page.$(sel);
      if (!btn) continue;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      // Try normal click first, then force if element is technically obscured
      try { await btn.click({ timeout: 5000 }); return true; } catch {
        await btn.click({ force: true, timeout: 3000 }); return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Verify that a form was actually submitted — checks confirmation signals and takes screenshot.
 * Call this 5s after clickSubmit() returns true.
 * @param {import('playwright').Page} page
 * @param {{ company: string, originalUrl: string }} jobInfo
 * @returns {Promise<{ confirmed: boolean, screenshotPath: string, finalUrl: string, pageTitle: string }>}
 */
export async function verifySubmission(page, jobInfo) {
  await page.waitForTimeout(5000);

  const screenshotPath = `/tmp/proof_${(jobInfo.company || 'unknown').replace(/[^a-z0-9]/gi, '_').slice(0, 30)}_${Date.now()}.png`;
  try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}

  const pageText = await page.textContent('body').catch(() => '');
  const SUCCESS_SIGNALS = [
    'thank you', 'thanks for applying', 'application received', 'application submitted',
    'submitted successfully', 'we received your application', 'we\'ve received',
    'application is being reviewed', 'application has been submitted',
    'gracias', 'tu postulación', 'recibimos tu aplicación', 'aplicación enviada',
    'confirmation', 'successfully applied', 'you have applied',
  ];
  const isConfirmed = SUCCESS_SIGNALS.some(s => pageText.toLowerCase().includes(s));
  const urlChanged  = page.url() !== jobInfo.originalUrl;

  return {
    confirmed: isConfirmed || urlChanged,
    screenshotPath,
    finalUrl:  page.url(),
    pageTitle: await page.title().catch(() => ''),
  };
}

/**
 * Find and click an "Apply" link/button that navigates to the actual form.
 * Returns href string if clicked, null otherwise.
 * @param {import('playwright').Page} page
 */
export async function clickApplyLink(page) {
  for (const sel of APPLY_LINK_SELECTORS) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        const href = await btn.getAttribute('href');
        await btn.click({ force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        return href || sel;
      }
    } catch {}
  }
  return null;
}
