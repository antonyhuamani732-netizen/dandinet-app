// Inicio de sesión con Google (Google Identity Services).
// Google entrega un "ID token" (dura ~1 hora) que se envía al servidor en cada llamada.
import { CONFIG } from './config.js';
import { kvGet, kvSet } from './db.js';

let _alRecibir = null;     // función que espera un token nuevo
let _iniciado = false;

/** Lee el contenido (payload) de un token JWT sin verificarlo (la verificación la hace el servidor). */
export function leerToken(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch (e) { return null; }
}

export const googleDisponible = () => typeof window.google !== 'undefined' && google.accounts && google.accounts.id;

/** Prepara Google Identity Services. alIniciarSesion(token) se llama cada vez que Google entrega un token. */
export function iniciarGoogle(alIniciarSesion) {
  if (!googleDisponible() || _iniciado) return _iniciado;
  google.accounts.id.initialize({
    client_id: CONFIG.CLIENT_ID,
    auto_select: true,               // si ya inició sesión antes, renueva sin preguntar
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    callback: async (r) => {
      await kvSet('token', r.credential);
      if (_alRecibir) { _alRecibir(r.credential); _alRecibir = null; }
      if (alIniciarSesion) alIniciarSesion(r.credential);
    },
  });
  _iniciado = true;
  return true;
}

export function dibujarBoton(el) {
  if (!googleDisponible()) { el.innerHTML = '<p class="aviso">Sin conexión con Google. Conéctese a internet para iniciar sesión.</p>'; return; }
  google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'es', width: 280 });
}

/** Token vigente (con al menos 2 minutos de vida) o null. */
export async function tokenVigente() {
  const t = await kvGet('token');
  const p = t && leerToken(t);
  return p && p.exp * 1000 > Date.now() + 120000 ? t : null;
}

/** Devuelve un token vigente; si venció, pide uno nuevo a Google (sin preguntar si es posible). */
export async function obtenerToken() {
  const t = await tokenVigente();
  if (t) return t;
  if (!googleDisponible()) throw Object.assign(new Error('Sin conexión con Google'), { codigo: 'RED' });
  return new Promise((ok, mal) => {
    const espera = setTimeout(() => { _alRecibir = null; mal(Object.assign(new Error('Debe volver a iniciar sesión'), { codigo: 'AUTH' })); }, 25000);
    _alRecibir = (tok) => { clearTimeout(espera); ok(tok); };
    google.accounts.id.prompt();
  });
}

export function cerrarSesionGoogle() {
  if (googleDisponible()) google.accounts.id.disableAutoSelect();
}
