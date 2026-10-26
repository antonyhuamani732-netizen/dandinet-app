// Comunicación con el servidor (Apps Script). Envío como text/plain: evita el
// "preflight" CORS que Apps Script no admite.
import { CONFIG } from './config.js';
import { obtenerToken, olvidarSesion } from './auth.js';

// tiempo máximo de espera: una llamada colgada (señal débil) ya no traba la sincronización para siempre
const ESPERA_MS = { sincronizar: 60000, enviarCola: 60000, comprobante: 60000 };

export async function llamar(accion, params = {}, opciones = {}) {
  if (!navigator.onLine) throw Object.assign(new Error('Sin conexión a internet'), { codigo: 'RED' });
  const idToken = await obtenerToken(opciones);
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
    j = await r.json();
  } catch (e) {
    const tarde = e && e.name === 'AbortError';
    throw Object.assign(new Error(tarde ? 'La señal está muy lenta: se reintentará solo.' : 'No se pudo conectar con el servidor'), { codigo: 'RED' });
  } finally {
    if (reloj) clearTimeout(reloj);
  }
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
