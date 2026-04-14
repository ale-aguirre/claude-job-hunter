/**
 * cv-reader.mjs — Parse CV PDF to text, with cache
 * Uses pdf-parse (no API keys needed — runs locally)
 *
 * Usage:
 *   import { getCVText } from './cv-reader.mjs'
 *   const text = await getCVText()  // returns cached after first call
 */
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
import 'dotenv/config';

const CV_PATH = process.env.CV_PATH || '';

let _cvText = null;

/**
 * Read and parse CV PDF to plain text.
 * Caches result in memory for the process lifetime.
 * @returns {Promise<string>} Extracted text (empty string if CV_PATH not set)
 */
export async function getCVText() {
  if (_cvText !== null) return _cvText;

  if (!CV_PATH) {
    console.warn('[cv-reader] CV_PATH not set in .env — cover letters will use PROFILE_TEXT only');
    _cvText = '';
    return '';
  }

  if (!existsSync(CV_PATH)) {
    console.warn(`[cv-reader] CV file not found at: ${CV_PATH}`);
    _cvText = '';
    return '';
  }

  try {
    const pdfParse = require('pdf-parse');
    const buffer = readFileSync(CV_PATH);
    const data = await pdfParse(buffer);
    _cvText = data.text.replace(/\s{3,}/g, '\n').slice(0, 4000); // cap at 4k chars
    return _cvText;
  } catch (e) {
    console.warn(`[cv-reader] Failed to parse CV: ${e.message.slice(0, 80)}`);
    _cvText = '';
    return '';
  }
}

/** Reset cache (useful for tests) */
export function resetCVCache() { _cvText = null; }
