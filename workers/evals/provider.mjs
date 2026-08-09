/**
 * provider.mjs — promptfoo custom provider for the CV tailoring stage.
 *
 * The system under test is not a prompt in isolation: it is the LLM selection
 * followed by the deterministic validator. Evaluating only the prompt would
 * miss the guardrail, and evaluating only the validator would miss the model.
 * So the provider runs both and returns the post-validation state.
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// promptfoo runs with evals/ as cwd, so the workers/.env has to be named.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { callTailorLLM, validate, getFacts } = await import('../cv-tailor.mjs');

export default class CvTailorProvider {
  id() {
    return 'cv-tailor';
  }

  /**
   * @param {string} prompt   the job description under test
   * @param {object} context  promptfoo context; vars carry role/lang
   */
  async callApi(prompt, context) {
    const vars = context?.vars || {};
    const role = vars.role || 'fullstack';
    const lang = vars.lang || 'en';
    const facts = getFacts();
    const job = { title: vars.title || '', notes: prompt };

    try {
      const raw = await callTailorLLM(facts, job, role, lang);
      // Keep a copy: validate() mutates the selection in place, and the whole
      // point of the eval is to see what the model produced before repair.
      const before = JSON.parse(JSON.stringify(raw));
      const errors = validate(raw, facts, lang);

      return {
        output: {
          before,
          after: raw,
          validation_errors: errors,
          repaired: errors.length > 0,
        },
      };
    } catch (err) {
      return { error: `${err.message}` };
    }
  }
}
