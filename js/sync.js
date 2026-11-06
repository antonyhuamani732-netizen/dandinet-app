// SINCRONIZACIÓN Y COLA DE ENVÍO
// Todo lo que se registra en el celular va primero a la COLA (IndexedDB). Si hay señal
// se envía de inmediato; si no, queda "pendiente de envío" y se envía solo al volver
// la conexión. Cada operación tiene un idSolicitud único: reenviarla nunca la duplica.
import { CONFIG } from './config.js';
import { llamar } from './api.js';
import { sesionVigente, guardarSesion } from './auth.js';
import { kvGet, kvSet, kvDel, kvClaves, colaPut, colaTodos, colaVaciar, colaBorrar } from './db.js';
import { D, aplicar, aplicarPendientes, ahoraISO, altasProcesadas } from './datos.js';

let _enCurso = null;
let _parcial = null;
let _ultimoInicio = 0;
// se registró algo mientras ya se sincronizaba: al terminar se envía enseguida (antes esperaba hasta 3 min)
let _repetir = false;
const oyentes = new Set();
export const alCambiar = (fn) => oyentes.add(fn);
const avisar = (info) => oyentes.forEach((fn) => { try { fn(info); } catch (e) { /* vista */ } });

/** Guarda una operación en la cola y, si hay señal, la envía. */
export async function encolar(op) {
  op.idSolicitud = op.idSolicitud || crypto.randomUUID();
  op.fDispositivo = op.fDispositivo || ahoraISO();
  op.estadoLocal = 'pendiente';           // pendiente | enviado | ok | rechazado | error
  op.offline = !navigator.onLine;
  await colaPut(op);
  aplicarPendientes([op]);                // el técnico ve su cambio al instante, con o sin señal
  avisar({ tipo: 'cola' });
  if (navigator.onLine) setTimeout(() => sincronizarTodo().catch(() => {}), 0);   // se envía en segundo plano
  return op;
}

/** Vuelve a poner sobre los datos descargados lo que este celular aún no envió. */
export async function reaplicarPendientes() {
  // los avisos de WhatsApp ya enviados también: si Android cerró la app entre el envío y la descarga, el
  // cliente no debe volver a aparecer como "por avisar" (aplicarPendientes no duplica: compara ID_SOLICITUD)
  const todas = await colaTodos();
  D.altasOk = altasProcesadas(todas);     // (1.32.0) códigos reales de los clientes que se crearon sin señal
  const avisos = todas.filter((o) => o.estadoLocal === 'ok' && o.tipo === 'REGISTRAR_AVISO');
  aplicarPendientes((await pendientesDeEnvio()).concat(avisos));
}

/** Número provisional para el comprobante hecho sin señal: PEND-<iniciales>-<n> */
export async function siguienteProvisional(iniciales) {
  const n = (Number(await kvGet('contadorProvisional')) || 0) + 1;
  await kvSet('contadorProvisional', n);
  return `PEND-${iniciales || 'US'}-${n}`;
}

export async function pendientesDeEnvio() {
  return (await colaTodos()).filter((o) => o.estadoLocal === 'pendiente' || o.estadoLocal === 'enviado' || o.estadoLocal === 'error');
}

/**
 * El sistema pasó a otro libro (ej. de PRUEBAS al DEFINITIVO): se borra lo guardado del anterior
 * (cola, PDF, dashboard, reportes) para no mezclar números de recibo ni enviar operaciones de prueba.
 */
/** Borra lo ya enviado (historial) y las copias guardadas (PDF, dashboard, reportes). Lo PENDIENTE no se toca. */
async function limpiarHistorialLocal() {
  for (const o of await colaTodos()) if (o.estadoLocal === 'ok' || o.estadoLocal === 'rechazado') await colaBorrar(o.idSolicitud);
  for (const k of await kvClaves()) if (/^(pdf|dash_|mov_|cuenta_)/.test(String(k))) await kvDel(k);
}

async function limpiarPorCambioDeLibro(nuevo) {
  await colaVaciar();
  for (const k of await kvClaves()) if (/^(pdf|dash_|mov_|cuenta_)/.test(String(k))) await kvDel(k);
  await kvSet('libroId', nuevo);
  avisar({ tipo: 'libro' });
}

/** Envía la cola y luego descarga datos frescos. Evita ejecuciones simultáneas. */
export function sincronizarTodo() {
  // una sincronización que lleva más de 3 minutos se da por perdida (antes trababa todo hasta cerrar la app)
  if (_enCurso && Date.now() - _ultimoInicio < 180000) { _repetir = true; return _enCurso; }
  _ultimoInicio = Date.now();
  _enCurso = (async () => {
    avisar({ tipo: 'inicio' });
    try {
      // (1.30.0) con un solo lote por enviar: envío + descarga en UNA llamada (antes dos viajes al servidor)
      let s = await enviarYBajar();
      if (!s) {
        await enviarCola();
        // sinClaves: las claves WiFi/router no se guardan en el celular; se piden al abrir la ficha
        s = await llamar('sincronizar', { sinClaves: true });
      }
      const antes = await kvGet('libroId');
      if (s.libro && antes && antes !== s.libro) await limpiarPorCambioDeLibro(s.libro);
      if (s.libro) await kvSet('libroId', s.libro);
      // limpieza ÚNICA por libro: también para celulares que no conocían el libro anterior
      if (s.libro && !(await kvGet('limpio_' + s.libro))) { await limpiarHistorialLocal(); await kvSet('limpio_' + s.libro, true); }
      await kvSet('datos', s);
      await kvSet('ultimaSync', ahoraISO());
      aplicar(s);
      await reaplicarPendientes();
      avisar({ tipo: 'fin', ok: true });
      asegurarSesion();                     // sesión de la app de 30 días (sin esperar)
    } catch (e) {
      avisar({ tipo: 'fin', ok: false, error: e });
      throw e;
    } finally {
      if (_enCurso === yo) {
        _enCurso = null;
        if (_repetir) {
          _repetir = false;
          // solo si quedó algo por enviar (no se vuelve a bajar todo por gusto)
          pendientesDeEnvio().then((p) => { if (p.length && navigator.onLine) sincronizarTodo().catch(() => {}); }).catch(() => {});
        }
      }
    }
  })();
  const yo = _enCurso;
  return _enCurso;
}

/**
 * Sesión de la app (30 días): se pide una vez con el token de Google y se renueva cuando le
 * quedan menos de 20 días. Un servidor anterior a la 1.25.0 no la conoce: se ignora el error.
 */
async function asegurarSesion() {
  try {
    const s = await sesionVigente();
    if (s && Number(s.vence) - Date.now() > 20 * 86400000) return;
    await guardarSesion(await llamar('sesion'));
  } catch (e) { /* se reintenta en la próxima sincronización */ }
}

/**
 * Descarga liviana (PPPoE, servicios y resumen) para ver al momento lo que hizo otro técnico,
 * sin bajar todo. Si hay una sincronización completa en curso, espera esa.
 */
export function sincronizarParcial() {
  if (_enCurso) return _enCurso;
  if (_parcial) return _parcial;
  _parcial = (async () => {
    try {
      await enviarCola();
      const p = await llamar('sincronizarParcial');
      const s = await kvGet('datos');
      if (!s || !p || !p.parcial || (s.libro && p.libro && s.libro !== p.libro)) return false;
      ['pppoe', 'histPPPoE', 'servicios', 'resumen'].forEach((k) => { if (p[k]) s[k] = p[k]; });
      await kvSet('datos', s);
      aplicar(s);
      await reaplicarPendientes();
      avisar({ tipo: 'parcial' });
      return true;
    } catch (e) { return false; } finally { _parcial = null; }
  })();
  return _parcial;
}

// el servidor conoce "enviarYSincronizar" desde la API v33; si responde que no, se usa el camino de siempre
let _sinCombinado = false;

/**
 * Envía lo pendiente (si cabe en un lote) y trae los datos frescos en la misma llamada.
 * Devuelve el paquete de datos, o null si no corresponde (nada que enviar, varios lotes o servidor anterior).
 */
async function enviarYBajar() {
  if (_sinCombinado) return null;
  const pend = (await pendientesDeEnvio()).sort((a, b) => String(a.fDispositivo).localeCompare(String(b.fDispositivo)));
  if (!pend.length || pend.length > CONFIG.LOTE_ENVIO) return null;
  const envio = pend.map((o) => { const { estadoLocal, resultado, intentos, ...limpio } = o; return limpio; });
  let r;
  try {
    r = await llamar('enviarYSincronizar', { operaciones: envio, libro: (await kvGet('libroId')) || '', sinClaves: true });
  } catch (e) {
    if (e.codigo === 'NEGOCIO' && /desconocida/i.test(e.message)) { _sinCombinado = true; return null; }   // servidor anterior
    await marcarFallaEnvio(pend, e);
    throw e;
  }
  if (r.envio && r.envio.libroCambiado) { await limpiarPorCambioDeLibro(r.envio.libro); return null; }
  await guardarResultados(pend, (r.envio && r.envio.resultados) || []);
  return r.datos || null;
}

/** Sin señal o error: se anota en cada operación (igual que el envío de siempre). */
async function marcarFallaEnvio(lote, e) {
  if (e.codigo === 'RED') {
    // no salió por falta de señal: se marca como trabajo "sin señal" para que el
    // servidor, si hay conflicto, lo deje A REVISAR en vez de perder el cobro
    for (const o of lote) { o.offline = true; await colaPut(o); }
  } else if (e.codigo !== 'AUTH') {
    for (const o of lote) { o.estadoLocal = 'error'; o.intentos = (o.intentos || 0) + 1; o.resultado = { mensaje: e.message }; await colaPut(o); }
  }
}

/** Anota en la cola del celular lo que respondió el servidor por cada operación. */
async function guardarResultados(lote, resultados) {
  for (const res of resultados) {
    const o = lote.find((x) => x.idSolicitud === res.idSolicitud);
    if (!o) continue;
    o.resultado = res;
    o.estadoLocal = res.estado === 'PROCESADO' ? 'ok' : res.estado === 'RECHAZADO' ? 'rechazado' : 'enviado';
    await colaPut(o);
    if (o.estadoLocal === 'rechazado') avisar({ tipo: 'rechazo', op: o, mensaje: res.mensaje || '' });
  }
  avisar({ tipo: 'cola' });
}

async function enviarCola() {
  const pend = (await pendientesDeEnvio()).sort((a, b) => String(a.fDispositivo).localeCompare(String(b.fDispositivo)));
  for (let i = 0; i < pend.length; i += CONFIG.LOTE_ENVIO) {
    const lote = pend.slice(i, i + CONFIG.LOTE_ENVIO);
    const envio = lote.map((o) => {
      const { estadoLocal, resultado, intentos, ...limpio } = o;  // no se envían campos internos
      return limpio;
    });
    let r;
    try {
      r = await llamar('enviarCola', { operaciones: envio, libro: (await kvGet('libroId')) || '' });
    } catch (e) {
      if (e.codigo === 'RED') {
        // no salió por falta de señal: se marca como trabajo "sin señal" para que el
        // servidor, si hay conflicto, lo deje A REVISAR en vez de perder el cobro
        for (const o of lote) { o.offline = true; await colaPut(o); }
      } else if (e.codigo !== 'AUTH') {
        for (const o of lote) { o.estadoLocal = 'error'; o.intentos = (o.intentos || 0) + 1; o.resultado = { mensaje: e.message }; await colaPut(o); }
      }
      throw e;
    }
    if (r.libroCambiado) { await limpiarPorCambioDeLibro(r.libro); return; }   // lo pendiente era del libro anterior
    for (const res of r.resultados) {
      const o = lote.find((x) => x.idSolicitud === res.idSolicitud);
      if (!o) continue;
      o.resultado = res;
      o.estadoLocal = res.estado === 'PROCESADO' ? 'ok' : res.estado === 'RECHAZADO' ? 'rechazado' : 'enviado';
      await colaPut(o);
      if (o.estadoLocal === 'rechazado') avisar({ tipo: 'rechazo', op: o, mensaje: res.mensaje || '' });
    }
    avisar({ tipo: 'cola' });
  }
}

/** Sincronización automática: al abrir, al volver la señal y cada N minutos. */
export function iniciarAutoSync() {
  window.addEventListener('online', () => { avisar({ tipo: 'red' }); sincronizarTodo().catch(() => {}); });
  window.addEventListener('offline', () => avisar({ tipo: 'red' }));
  setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') sincronizarTodo().catch(() => {}); },
    CONFIG.SYNC_CADA_MIN * 60000);
  document.addEventListener('visibilitychange', () => {
    // al volver a la app: solo si pasó más de 1 minuto desde la última sincronización
    if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - _ultimoInicio > 60000) sincronizarTodo().catch(() => {});
  });
}
