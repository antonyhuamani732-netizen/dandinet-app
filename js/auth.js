// Inicio de sesión con Google (Google Identity Services) + sesión propia de la app.
// Google entrega un "ID token" que dura ~1 hora. Desde la 1.25.0, con ese token el servidor
// entrega una SESIÓN de la app (30 días, se renueva sola al sincronizar): así el técnico no
// queda "sin sincronizar" cuando Google no logra renovar el token en el celular.
import { CONFIG } from './config.js';
import { kvGet, kvSet, kvDel } from './db.js';

const _esperan = [];       // llamadas que esperan un token nuevo de Google (se atienden todas juntas)
let _iniciado = false;
let _alIniciar = null;

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
  _alIniciar = alIniciarSesion;
  if (!googleDisponible() || _iniciado) return _iniciado;
  google.accounts.id.initialize({
    client_id: CONFIG.CLIENT_ID,
    auto_select: true,               // si ya inició sesión antes, renueva sin preguntar
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    callback: async (r) => {
      await kvSet('token', r.credential);
      while (_esperan.length) _esperan.shift().ok(r.credential);
      if (_alIniciar) _alIniciar(r.credential);
    },
  });
  _iniciado = true;
  return true;
}

export function dibujarBoton(el, texto = 'signin_with') {
  if (!googleDisponible()) { el.innerHTML = '<p class="aviso">Sin conexión con Google. Conéctese a internet para iniciar sesión.</p>'; return; }
  google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', text: texto, shape: 'pill', locale: 'es', width: 280 });
}

/** Sesión de la app vigente (al menos 1 minuto de vida) o null. */
export async function sesionVigente() {
  const s = await kvGet('sesion');
  return s && s.sesion && Number(s.vence) > Date.now() + 60000 ? s : null;
}
export const guardarSesion = (s) => (s && s.sesion ? kvSet('sesion', { sesion: s.sesion, vence: Number(s.vence) }) : null);
export const olvidarSesion = () => kvDel('sesion');

/** Token de Google vigente (con al menos 2 minutos de vida) o null. */
export async function tokenVigente() {
  const t = await kvGet('token');
  const p = t && leerToken(t);
  return p && p.exp * 1000 > Date.now() + 120000 ? t : null;
}

/**
 * Credencial para llamar al servidor: la sesión de la app si existe; si no, el token de Google
 * (si venció, se pide uno nuevo sin preguntar cuando es posible). Varias llamadas a la vez
 * esperan la MISMA renovación (antes la segunda pisaba a la primera y fallaba).
 */
export async function obtenerToken({ soloGoogle = false } = {}) {
  if (!soloGoogle) { const s = await sesionVigente(); if (s) return s.sesion; }
  const t = await tokenVigente();
  if (t) return t;
  if (!googleDisponible()) throw Object.assign(new Error('Sin conexión con Google'), { codigo: 'RED' });
  return new Promise((ok, mal) => {
    const item = { ok: (tok) => { clearTimeout(espera); ok(tok); } };
    const espera = setTimeout(() => {
      const i = _esperan.indexOf(item); if (i >= 0) _esperan.splice(i, 1);
      mal(Object.assign(new Error('Su sesión venció. Toque "Reconectar" para seguir sincronizando.'), { codigo: 'AUTH' }));
    }, 20000);
    _esperan.push(item);
    if (_esperan.length === 1) { try { google.accounts.id.prompt(); } catch (e) { /* lo resuelve el botón Reconectar */ } }
  });
}

export function cerrarSesionGoogle() {
  if (googleDisponible()) google.accounts.id.disableAutoSelect();
}
