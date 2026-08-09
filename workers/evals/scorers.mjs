/**
 * scorers.mjs — deterministic graders for the CV tailoring evals.
 *
 * No LLM-as-judge here on purpose: every property below is checkable in code,
 * and a judge would only add cost and variance to a decidable question.
 */
import { getFacts } from '../cv-tailor.mjs';

const facts = getFacts();
const declaredSkills = facts.skills.map(s => s.label.toLowerCase());

/**
 * Every technology the CV is allowed to name, derived from cv-facts.json
 * rather than hand-listed, so adding a skill updates the grader for free.
 */
const allowedTerms = new Set(
  declaredSkills
    .flatMap(label => label.split(/[\s/(),.]+/))
    .map(w => w.replace(/[^a-z0-9+#.]/g, ''))
    .filter(w => w.length > 1)
);
// Words that appear inside skill labels but carry no technology meaning.
for (const w of ['api', 'apis', 'servers', 'server', 'ui', 'css', 'sdk', 'code', 'output', 'use', 'tool', 'multi', 'agent', 'agents', 'orchestration', 'engineering', 'structured', 'browser', 'automation', 'motion']) {
  allowedTerms.delete(w);
}

/**
 * Technologies a reader would recognise as a hard claim. If one of these shows
 * up in a generated summary and is not in cv-facts.json, the CV is lying.
 * This list exists to catch the model, not to enumerate the world.
 */
const KNOWN_TECH = [
  'kubernetes', 'k8s', 'docker', 'aws', 'gcp', 'azure', 'redis', 'kafka', 'rabbitmq',
  'terraform', 'ansible', 'jenkins', 'circleci', 'express', 'nestjs', 'fastify',
  'angular', 'vue', 'svelte', 'solid', 'ember', 'backbone',
  'django', 'rails', 'laravel', 'spring', 'dotnet', '.net', 'phoenix',
  'rust', 'golang', 'java', 'kotlin', 'swift', 'scala', 'elixir', 'ruby', 'php', 'c++', 'c#',
  'pytorch', 'tensorflow', 'keras', 'scikit', 'huggingface', 'transformers',
  'langchain', 'langgraph', 'llamaindex', 'crewai', 'autogen', 'haystack', 'semantic kernel',
  'pinecone', 'weaviate', 'qdrant', 'milvus', 'elasticsearch', 'opensearch',
  'kubeflow', 'mlflow', 'airflow', 'dbt', 'snowflake', 'databricks', 'spark', 'hadoop',
  'graphene', 'hasura', 'firebase', 'dynamodb', 'mongodb', 'cassandra', 'neo4j',
  'jenkins', 'bazel', 'webpack', 'vite', 'rollup', 'grpc', 'protobuf', 'websockets',
  'fine-tuning', 'fine tuning', 'rlhf', 'lora', 'quantization', 'distillation',
];

/**
 * Assert: the generated summary names no technology the profile does not have.
 * This is the anti-hallucination property. It is the one that matters, because
 * a fabricated skill on a CV is caught in the interview and ends the process.
 */
export function noUndeclaredTech(output) {
  const summary = (output?.before?.summary || '').toLowerCase();
  if (!summary) return { pass: false, score: 0, reason: 'no summary produced' };

  const violations = KNOWN_TECH.filter(term => {
    if (!summary.includes(term)) return false;
    // Allowed if the profile actually declares it.
    return !declaredSkills.some(label => label.includes(term));
  });

  return violations.length === 0
    ? { pass: true, score: 1, reason: 'summary claims nothing outside cv-facts.json' }
    : { pass: false, score: 0, reason: `fabricated: ${violations.join(', ')}` };
}

/**
 * Assert: nothing fabricated survives into the document that actually gets sent.
 *
 * Separate from noUndeclaredTech on purpose. That one grades the model;
 * this one grades the system. The model is allowed to fail here as long as
 * the deterministic validator catches it, which is the whole reason the
 * validator exists.
 */
export function shippedOutputClean(output) {
  const summary = (output?.after?.summary || '').toLowerCase();
  if (!summary) return { pass: false, score: 0, reason: 'no summary in shipped output' };

  const violations = KNOWN_TECH.filter(
    term => summary.includes(term) && !declaredSkills.some(label => label.includes(term))
  );

  return violations.length === 0
    ? { pass: true, score: 1, reason: 'shipped CV claims only declared facts' }
    : { pass: false, score: 0, reason: `LEAKED TO PDF: ${violations.join(', ')}` };
}

/** Assert: every id the model returned exists. Measures raw model discipline. */
export function idsAllReal(output) {
  const errs = output?.validation_errors || [];
  const unknown = errs.filter(e => e.startsWith('unknown'));
  return unknown.length === 0
    ? { pass: true, score: 1, reason: 'all ids resolved' }
    : { pass: false, score: 0, reason: unknown.join(' | ') };
}

/**
 * Assert: the role routed matches what the posting is actually asking for.
 * The expectation travels in vars.expect_role because promptfoo resolves
 * `file://` graders by name only and cannot pass arguments to them.
 */
export function roleMatches(output, context) {
  const expected = context?.vars?.expect_role;
  if (!expected) return { pass: true, score: 1, reason: 'no expectation set' };
  const got = output?.before?.headline_role;
  return got === expected
    ? { pass: true, score: 1, reason: `routed to ${got}` }
    : { pass: false, score: 0, reason: `routed to ${got}, expected ${expected}` };
}

/** Assert: summary stays inside the length window the one-page layout needs. */
export function summaryLength(output) {
  const n = (output?.before?.summary || '').split(/\s+/).filter(Boolean).length;
  return n >= 25 && n <= 45
    ? { pass: true, score: 1, reason: `${n} words` }
    : { pass: false, score: 0, reason: `${n} words, want 25-45` };
}

/** Assert: the shape the renderer depends on is present and within bounds. */
export function shapeValid(output) {
  const s = output?.before || {};
  const problems = [];
  const skills = s.skill_ids_ordered || [];
  const projects = s.project_ids_ordered || [];
  if (skills.length < 6 || skills.length > 10) problems.push(`${skills.length} skills, want 6-10`);
  if (projects.length > 3) problems.push(`${projects.length} projects, max 3`);
  if (!s.experience_bullet_ids?.cd?.length) problems.push('no cd bullets selected');
  return problems.length === 0
    ? { pass: true, score: 1, reason: 'shape within bounds' }
    : { pass: false, score: 0, reason: problems.join('; ') };
}

/** Assert: an AI posting surfaces AI skills near the top, not buried. */
export function aiSkillsPrioritised(output) {
  const ids = output?.before?.skill_ids_ordered || [];
  const aiIds = new Set(facts.skills.filter(s => s.category === 'ai').map(s => s.id));
  const topFive = ids.slice(0, 5);
  const hits = topFive.filter(id => aiIds.has(id)).length;
  return hits >= 2
    ? { pass: true, score: 1, reason: `${hits} AI skills in top 5` }
    : { pass: false, score: 0, reason: `only ${hits} AI skills in top 5` };
}
