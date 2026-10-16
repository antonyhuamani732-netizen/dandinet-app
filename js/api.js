// Comunicación con el servidor (Apps Script). Envío como text/plain: evita el
// "preflight" CORS que Apps Script no admite.
import { CONFIG } from './config.js';
import { obtenerToken } from './auth.js';

export async function llamar(accion, params = {}) {
  if (!navigator.onLine) throw Object.assign(new Error('Sin conexión a internet'), { codigo: 'RED' });
  const idToken = await obtenerToken();
  let r;
  try {
    r = await fetch(CONFIG.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ accion, idToken }, params)),
    });
  } catch (e) {
    throw Object.assign(new Error('No se pudo conectar con el servidor'), { codigo: 'RED' });
  }
  let j;
  try { j = await r.json(); } catch (e) { throw Object.assign(new Error('Respuesta inválida del servidor'), { codigo: 'RED' }); }
  if (!j.ok) throw Object.assign(new Error(j.error || 'Error del servidor'), { codigo: j.codigo || 'ERROR' });
  return j.datos;
}
