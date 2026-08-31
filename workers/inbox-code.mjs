/**
 * inbox-code.mjs — lee el código de seguridad que Greenhouse manda por email
 * antes de aceptar una postulación.
 *
 * Confirmado a mano el 26/8 revisando el Gmail de Alexis: entre 13:17 y
 * 13:24 llegaron cinco mensajes de no-reply@us.greenhouse-mail.io, asunto
 * "Security code for your application to Webflow", cada uno con un código
 * distinto (DCMIBL3V, XDKL3aaL, YtmZTMyV, oSleHYuP, 3Oew5Oac) y el cuerpo:
 *   "Copy and paste this code into the security code field on your
 *   application: DCMIBL3V
 *   After you enter the code, resubmit your application."
 * Esos cinco códigos nunca se usaron: el applier reintentaba a ciegas sin
 * leer el correo, Greenhouse mandaba otro código, y así hasta agotar los
 * reintentos. Este módulo cierra ese agujero leyendo el código real por
 * IMAP contra la casilla de Gmail.
 */
import 'dotenv/config';
import { ImapFlow } from 'imapflow';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const POLL_MS = 5000;

// El código sale siempre pegado a esta frase exacta del cuerpo. Un regex
// suelto de "8 alfanuméricos" matchearía el message-id, un número de
// referencia o cualquier otro token del mail — anclar a la frase es lo que
// evita traer basura en vez del código real.
// Ojo: Greenhouse manda estos mails sin parte text/plain (confirmado el
// 31/8 leyendo el mail real de Webflow: sólo text/html + una imagen inline)
// y el código va en un <h1> aparte, después de un </p> — por eso el ancla
// se aplica sobre el HTML ya despojado de tags, no sobre el HTML crudo.
const ANCLA_CODIGO_RE = /security code field on your application:\s*([A-Za-z0-9]{6,12})/i;

/**
 * Espera (poleando cada 5s) a que llegue el mail de Greenhouse con el
 * código de seguridad, y lo extrae.
 *
 * @param {{ desde: Date, empresa?: string, timeoutMs?: number }} opts
 *   desde: sólo se aceptan mensajes recibidos DESPUÉS de este momento. Un
 *   código viejo de otra postulación no sirve, y usarlo sería peor que
 *   fallar — por eso se compara el Date completo del mail, no sólo el día
 *   (el SEARCH de IMAP con "since" filtra por fecha, no por hora).
 * @returns {Promise<{ ok: true, codigo: string, recibidoEn: Date } | { ok: false, razon: string }>}
 */
export async function esperarCodigoDeSeguridad({ desde, empresa, timeoutMs = 120000 }) {
  if (!(desde instanceof Date) || isNaN(desde.getTime())) {
    return { ok: false, razon: 'esperarCodigoDeSeguridad: "desde" tiene que ser un Date válido' };
  }

  const user = process.env.EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return { ok: false, razon: 'EMAIL o GMAIL_APP_PASSWORD no están seteados en .env' };
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
  } catch (e) {
    return { ok: false, razon: `no se pudo conectar al IMAP de Gmail: ${e.message.slice(0, 150)}` };
  }

  try {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      let candidato = null;

      const lock = await client.getMailboxLock('INBOX');
      try {
        // "since" acá es sólo para no traer meses de correo — su
        // granularidad es de día completo, no de hora. El filtro que de
        // verdad importa (recibido después de "desde") va abajo, comparando
        // el Date entero de cada mensaje.
        const uids = await client.search(
          { from: 'greenhouse-mail.io', since: desde, subject: 'Security code' },
          { uid: true }
        );

        if (uids.length > 0) {
          const mensajes = await client.fetchAll(uids, { envelope: true, bodyStructure: true }, { uid: true });
          const candidatos = mensajes
            .filter(m => new Date(m.envelope.date) > desde)
            .sort((a, b) => new Date(b.envelope.date) - new Date(a.envelope.date));

          candidato = (empresa
            ? candidatos.find(m => (m.envelope.subject || '').toLowerCase().includes(empresa.toLowerCase()))
            : null) || candidatos[0] || null;
        }
      } finally {
        lock.release();
      }

      if (candidato) {
        // Preferimos text/plain si existe; Greenhouse en la práctica sólo
        // manda text/html (confirmado el 31/8), así que hay fallback.
        let parte = buscarParteDeTexto(candidato.bodyStructure, 'text/plain');
        let esHtml = false;
        if (!parte) { parte = buscarParteDeTexto(candidato.bodyStructure, 'text/html'); esHtml = true; }

        if (parte) {
          const { content } = await client.download(candidato.uid, parte, { uid: true });
          const chunks = [];
          for await (const chunk of content) chunks.push(chunk);
          let cuerpo = Buffer.concat(chunks).toString('utf-8');
          // El código vive en un <h1> separado de la frase por un </p>, así
          // que hay que sacar las tags antes de anclar el regex — si no, el
          // "\s*" del ancla nunca llega a tocar el código.
          if (esHtml) cuerpo = cuerpo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

          const match = cuerpo.match(ANCLA_CODIGO_RE);
          if (match) {
            return { ok: true, codigo: match[1], recibidoEn: new Date(candidato.envelope.date) };
          }
          // Llegó el mail correcto pero el cuerpo no matcheó el ancla —
          // no hay que inventar un código, se sigue esperando por si es
          // un formato de mail distinto que todavía no llegó.
          console.warn('[inbox-code] mail de "Security code" recibido pero el cuerpo no matcheó el patrón esperado — se sigue esperando');
        } else {
          console.warn('[inbox-code] el mail de seguridad no tiene parte de texto legible (ni plain ni html) — se sigue esperando');
        }
      }

      const restante = deadline - Date.now();
      if (restante <= 0) break;
      await new Promise(r => setTimeout(r, Math.min(POLL_MS, restante)));
    }

    return { ok: false, razon: `no llegó ningún código de seguridad de Greenhouse en ${timeoutMs}ms` };
  } catch (e) {
    return { ok: false, razon: `error leyendo el inbox por IMAP: ${e.message.slice(0, 150)}` };
  } finally {
    // Cerrar siempre, pase lo que pase — una conexión IMAP colgada es un
    // recurso que se olvida y después falla en silencio en la próxima corrida.
    try { await client.logout(); } catch { try { client.close(); } catch {} }
  }
}

/** Busca recursivamente la parte text/plain en el bodyStructure de imapflow. */
function buscarParteDeTexto(node, tipo = 'text/plain') {
  if (!node) return null;
  if (node.type === tipo) return node.part || '1';
  if (node.childNodes) {
    for (const child of node.childNodes) {
      const found = buscarParteDeTexto(child, tipo);
      if (found) return found;
    }
  }
  return null;
}
