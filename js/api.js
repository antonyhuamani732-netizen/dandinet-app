// Comunicación con el servidor (Apps Script). Envío como text/plain: evita el
// "preflight" CORS que Apps Script no admite.
import { CONFIG } from './config.js';
import { obtenerToken, olvidarSesion } from './auth.js';
import { kvGet, kvSet } from './db.js';

// MEDIDOR: cada llamada deja { hora, accion, total, token, servidor, kb, lect, ... } (las últimas 40), para ver
// en Cola → "Tiempos de conexión" si la demora es de la señal, del servidor de Google o de la espera de otro celular.
const MAX_MEDIDAS = 40;
async function anotarMedida(m) {
  try { const l = (await kvGet('medidas')) || []; l.unshift(m); await kvSet('medidas', l.slice(0, MAX_MEDIDAS)); } catch (e) { /* nunca impide trabajar */ }
}
export const medidas = async () => (await kvGet('medidas')) || [];

// tiempo máximo de espera: una llamada colgada (señal débil) ya no traba la sincronización para siempre
const ESPERA_MS = { sincronizar: 60000, enviarCola: 60000, comprobante: 60000 };

export async function llamar(accion, params = {}, opciones = {}) {
  if (!navigator.onLine) throw Object.assign(new Error('Sin conexión a internet'), { codigo: 'RED' });
  const t0 = Date.now();
  const idToken = await obtenerToken(opciones);
  const t1 = Date.now();
  const med = { hora: new Date().toISOString(), accion, token: t1 - t0, n: Array.isArray(params.operaciones) ? params.operaciones.length : undefined };
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const reloj = ctl ? setTimeout(() => ctl.abort(), ESPERA_MS[accion] || 30000) : null;
  let r, j;
  try {
    r = await fetch(CONFIG.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ accion, idToken }, params)),
      signal: ctl ? ctl.signal : undefined,
    });
    const txt = await r.text();
    med.kb = Math.round(txt.length / 102.4) / 10;
    j = JSON.parse(txt);
  } catch (e) {
    const tarde = e && e.name === 'AbortError';
    anotarMedida(Object.assign(med, { total: Date.now() - t0, error: tarde ? 'Tiempo agotado' : 'Sin conexión' }));
    throw Object.assign(new Error(tarde ? 'La señal está muy lenta: se reintentará solo.' : 'No se pudo conectar con el servidor'), { codigo: 'RED' });
  } finally {
    if (reloj) clearTimeout(reloj);
  }
  const t = (j && j.t) || {};
  anotarMedida(Object.assign(med, { total: Date.now() - t0, red: Date.now() - t1, servidor: t.ms, lect: t.lect, filas: t.filas,
    msLect: t.msLect, msCandado: t.msCandado, msGuardar: t.msGuardar, error: j && !j.ok ? String(j.codigo || 'ERROR') : '' }));
  if (!j || !j.ok) {
    // una sesión de la app que el servidor ya no acepta se descarta: la próxima vez se usa Google
    if (j && j.codigo === 'AUTH' && /^S1\./.test(idToken)) {
      await olvidarSesion();
      if (!opciones.reintento) return llamar(accion, params, Object.assign({}, opciones, { reintento: true }));
    }
    throw Object.assign(new Error((j && j.error) || 'Error del servidor'), { codigo: (j && j.codigo) || 'ERROR' });
  }
  return j.datos;
}
