// SINCRONIZACIÓN Y COLA DE ENVÍO
// Todo lo que se registra en el celular va primero a la COLA (IndexedDB). Si hay señal
// se envía de inmediato; si no, queda "pendiente de envío" y se envía solo al volver
// la conexión. Cada operación tiene un idSolicitud único: reenviarla nunca la duplica.
import { CONFIG } from './config.js';
import { llamar } from './api.js';
import { kvGet, kvSet, kvDel, kvClaves, colaPut, colaTodos, colaVaciar } from './db.js';
import { aplicar, ahoraISO } from './datos.js';

let _enCurso = null;
let _ultimoInicio = 0;
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
  avisar({ tipo: 'cola' });
  if (navigator.onLine) sincronizarTodo().catch(() => {});
  return op;
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
async function limpiarPorCambioDeLibro(nuevo) {
  await colaVaciar();
  for (const k of await kvClaves()) if (/^(pdf|dash_|mov_)/.test(String(k))) await kvDel(k);
  await kvSet('libroId', nuevo);
  avisar({ tipo: 'libro' });
}

/** Envía la cola y luego descarga datos frescos. Evita ejecuciones simultáneas. */
export function sincronizarTodo() {
  if (_enCurso) return _enCurso;
  _ultimoInicio = Date.now();
  _enCurso = (async () => {
    avisar({ tipo: 'inicio' });
    try {
      await enviarCola();
      const s = await llamar('sincronizar');
      const antes = await kvGet('libroId');
      if (s.libro && antes && antes !== s.libro) await limpiarPorCambioDeLibro(s.libro);
      if (s.libro) await kvSet('libroId', s.libro);
      await kvSet('datos', s);
      await kvSet('ultimaSync', ahoraISO());
      aplicar(s);
      avisar({ tipo: 'fin', ok: true });
    } catch (e) {
      avisar({ tipo: 'fin', ok: false, error: e });
      throw e;
    } finally {
      _enCurso = null;
    }
  })();
  return _enCurso;
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
