/**
 * rules.mjs — Shared scoring rules and constants used by filter.mjs and draft.mjs
 *
 * Export: SKIP_TITLES, SKIP_LOCATION, SKIP_TECH, MIN_SALARY_MO,
 *         BOOST_HIGH, BOOST_MED, scoreJob
 */
import { APPLY_KEYWORDS } from './config.mjs';

export const SKIP_TITLES   = ['senior staff', 'principal engineer', 'principal', 'director of', 'vp of', 'vice president', 'head of', 'cto', 'cpo'];
export const SKIP_LOCATION = ['on-site only', 'onsite only', 'on-site in', 'onsite in', 'in-office', 'no remote', 'not remote', 'hybrid in', 'must relocate', 'relocation required'];
export const SKIP_TECH     = ['python only', 'ruby on rails only', '.net only', 'java only', 'php only', 'golang only'];
export const MIN_SALARY_MO = 2000;

/** El título tiene que sonar a puesto técnico, no a ventas ni a soporte. */
export const DEV_SIGNAL = /engineer|developer|desarrollador|programador|full[ -]?stack|front[ -]?end|back[ -]?end|swe|software|tech lead|architect/i;

export const BOOST_HIGH = ['ai agent', 'llm', 'mcp', 'anthropic', 'claude', 'openai', 'agentic', 'autonomous'];
export const BOOST_MED  = ['typescript', 'next.js', 'nextjs', 'react', 'node.js', 'automation', 'ai', 'remote latam', 'latam'];

/** El stack que Alexis maneja de verdad, buscado en el título. */
export const CORE_STACK = /react|typescript|next\.?js|node|full[ -]?stack|front[ -]?end|javascript|graphql|postgres/i;

/** Lugares desde donde puede trabajar. Sale de locationRestrictions y de las notas. */
export const GOOD_LOCATION = /\b(latam|latin america|south america|argentina|worldwide|global|anywhere|americas)\b/i;

/**
 * ¿Aparece `needle` como palabra completa dentro de `hay`?
 *
 * Antes esto era un `includes()` a secas y descartaba avisos buenos en silencio:
 * 'cto' matcheaba adentro de "proye(cto)", así que CUALQUIER aviso escrito en
 * español que dijera "proyecto" se tiraba a la basura, igual que cualquiera que
 * mencionara "vector database", "director", "sector" o "detector". En una
 * búsqueda en LATAM eso es la mitad del mercado. Verificado el 18/8 sobre el
 * aviso de TeamUp, descartado por la palabra "proyecto".
 */
function tieneTermino(hay, needle) {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(hay);
}

export function scoreJob(job) {
  const text = `${job.title} ${job.notes} ${job.platform} ${job.location}`.toLowerCase();
  // Los descartes por cargo miran SOLO el título. Un aviso de dev que en la
  // descripción diga "reportás al head of engineering" sigue siendo un aviso
  // de dev.
  const title = String(job.title || '').toLowerCase();

  // El título tiene que ser de un puesto técnico. Sin esto, los boosts por
  // nombre de empresa colaban puestos de ventas: "Account Director, Digital
  // Native @ openai" sumaba 5 puntos sólo porque la empresa se llama openai.
  if (!DEV_SIGNAL.test(title)) return -1;

  if (SKIP_TITLES.some(s => tieneTermino(title, s))) return -1;
  if (SKIP_LOCATION.some(s => text.includes(s))) return -1;
  if (SKIP_TECH.some(s => text.includes(s))) return -1;
  if (job.pay_mo > 0 && job.pay_mo < MIN_SALARY_MO) return -1;

  // Piso 1. Si llegó hasta acá es un aviso de desarrollo que pasó todos los
  // descartes, o sea un lead válido aunque no mencione ninguna palabra premiada.
  // Con piso 0 quedaban 294 avisos empatados en cero, indistinguibles entre un
  // "Senior React Engineer" y ruido, que es la misma ceguera que tenía el filtro.
  let score = 1;

  // tieneTermino() y no includes(): 'ai' matcheaba adentro de "br(ai)ntrust",
  // "m(ai)ntain" y "tr(ai)ning", y regalaba un punto a avisos sin nada de IA.
  // Cuarta aparición del mismo bug de substring en este repo.
  for (const kw of BOOST_HIGH)     if (tieneTermino(text, kw)) score += 3;
  for (const kw of BOOST_MED)      if (tieneTermino(text, kw)) score += 1;
  for (const kw of APPLY_KEYWORDS) if (tieneTermino(text, kw.toLowerCase())) score += 1;

  // El stack real de Alexis en el TÍTULO pesa más que mencionado al pasar en la
  // descripción. Un "Senior React Engineer" es más suyo que un aviso de Go que
  // en los nice-to-have dice React.
  if (CORE_STACK.test(title)) score += 2;

  // Poder postularse no es un detalle. Desde que Himalayas devuelve
  // locationRestrictions, esto es un dato real y no una adivinanza.
  if (GOOD_LOCATION.test(text)) score += 2;

  // Su nivel es mid-senior con 5 años. Un junior le paga menos de lo que ya
  // gana y un intern directamente no aplica.
  if (/\b(junior|jr\.?|intern|internship|trainee|entry[ -]level|becario|pasant)\b/i.test(title)) score -= 3;
  if (/\bsenior\b|\bsr\.?\b|\bssr\b|semi[ -]?senior/i.test(title)) score += 1;

  if (job.pay_mo >= 3000) score += 5;
  if (job.pay_mo >= 4000) score += 3;

  return score;
}
