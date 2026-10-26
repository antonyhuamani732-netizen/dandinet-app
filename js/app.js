// APP D@NDINET — pantallas y navegación (#/ruta)
import { CONFIG } from './config.js';
import { kvGet, kvSet, colaTodos, borrarTodo } from './db.js';
import { iniciarGoogle, dibujarBoton, leerToken, cerrarSesionGoogle, googleDisponible } from './auth.js';
import { llamar } from './api.js';
import { encolar, sincronizarTodo, sincronizarParcial, reaplicarPendientes, iniciarAutoSync, alCambiar, pendientesDeEnvio, siguienteProvisional } from './sync.js';
import {
  D, cargarDatosLocales, esc, soles, r2, txtPeriodo, txtFecha, hoyISO, metodosPago, buscarClientes, serviciosDe,
  cargosDe, repartir, pppoeDisponibles, plantilla, enlaceWhatsApp, claseEstado, txtMora, prorrateoPlan,
  nombreServicio, nombreCargo, nombreCorto, ordenCargos, agruparLineas, serviciosDuo, detalleInstalacion,
} from './datos.js';
import { ic, observarIconos } from './iconos.js';

const $ = (s, el = document) => el.querySelector(s);
const vista = () => $('#vista');
let PERFIL = null;
let sincronizando = false;
let RUTA = 'inicio';
let REPINTAR = null;          // la vista actual sabe repintar solo sus datos (sin perder filtros ni posición)
let SESION_VENCIDA = false;
const AYUDA_SYNC = 'En línea: hay señal; lo que usted hace se envía solo en segundos.\nSin señal: puede seguir trabajando; todo queda guardado en el celular y se envía solo al volver la señal.\nN por enviar: operaciones guardadas que aún no llegan al servidor.\nAct. hace N min: cuándo se recibieron por última vez los cambios de los demás (se actualiza solo cada 3 minutos).\nSesión vencida: toque "Continuar con Google" en el aviso amarillo; no hace falta cerrar sesión.';   // Google no renovó la sesión: se muestra el botón Reconectar

// ============================================================================
// ARRANQUE
// ============================================================================
async function arrancar() {
  observarIconos();
  registrarServiceWorker();
  PERFIL = await kvGet('perfil');
  const hayDatos = await cargarDatosLocales();
  if (hayDatos) await reaplicarPendientes();   // lo hecho sin señal se ve al abrir la app
  alCambiar(alEventoSync);
  esperarGoogle();
  if (PERFIL && hayDatos) {
    mostrarApp();
    iniciarAutoSync();
    if (navigator.onLine) sincronizarTodo().catch(manejarErrorSync);
  } else {
    mostrarLogin();
  }
}

/** Registra el service worker y avisa cuando llega una versión nueva. */
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const habiaControl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaControl) return;                 // primera instalación: no hay nada que actualizar
    $('#actualizar').hidden = false;
    $('#btnActualizar').onclick = () => location.reload();
  });
}

/** El script de Google carga aparte (y no existe sin señal). */
function esperarGoogle(intentos = 0) {
  if (googleDisponible()) { iniciarGoogle(alIniciarSesion); if (!PERFIL) dibujarBoton($('#btnGoogle')); return; }
  if (intentos < 40) setTimeout(() => esperarGoogle(intentos + 1), 250);
  else if (!PERFIL && $('#btnGoogle')) dibujarBoton($('#btnGoogle'));
}

async function alIniciarSesion(token) {
  if (PERFIL) {                             // renovación del token (silenciosa o con el botón Reconectar)
    if (SESION_VENCIDA) { SESION_VENCIDA = false; ocultarReconectar(); pintarEstado(); sincronizarTodo().then(() => aviso('Reconectado: datos al día.')).catch(manejarErrorSync); }
    return;
  }
  const p = leerToken(token);
  $('#loginEstado').textContent = 'Verificando ' + (p ? p.email : '') + '…';
  try {
    PERFIL = await llamar('perfil');
    await kvSet('perfil', PERFIL);
    $('#loginEstado').textContent = 'Descargando datos…';
    await sincronizarTodo();
    mostrarApp();
    iniciarAutoSync();
  } catch (e) {
    PERFIL = null;
    $('#loginEstado').innerHTML = `<span class="error">${esc(e.message)}</span>`;
  }
}

function mostrarLogin() {
  $('#login').hidden = false;
  $('#app').hidden = true;
}

function mostrarApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#usuario').innerHTML = `<span>${esc(PERFIL.nombre)}</span><span class="avatar" aria-hidden="true">${esc(iniciales(PERFIL.nombre))}</span>`;
  window.addEventListener('hashchange', enrutar);
  enrutar();
  pintarEstado();
}

const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

// ============================================================================
// LÍNEA DE ESTADO (en línea / sin señal / pendientes) — compacta
// ============================================================================
async function pintarEstado() {
  const pend = (await pendientesDeEnvio()).length;
  const ult = await kvGet('ultimaSync');
  const el = $('#estado');
  const hora = ult ? (ult.slice(0, 10) === hoyISO() ? ult.slice(11, 16) : txtFecha(ult)) : '—';
  el.className = 'estado ' + (navigator.onLine ? 'en-linea' : 'sin-senal');
  const min = ult ? Math.floor((Date.now() - new Date(ult).getTime()) / 60000) : null;
  const hace = min === null ? '—' : min < 1 ? 'recién' : min < 60 ? `hace ${min} min` : hora;
  if (SESION_VENCIDA) el.className += ' vencida';
  el.innerHTML = `<span class="grupo"><span class="punto"></span>${SESION_VENCIDA ? 'Sesión vencida' : navigator.onLine ? 'En línea' : 'Sin señal'}</span>` +
    (sincronizando ? `<span class="grupo">${ic('sync', 'girando')}Sincronizando</span>` : '') +
    (pend ? `<span class="pend">${pend} por enviar</span>` : '') +
    `<span class="tenue">Act. ${esc(hace)}</span>` +
    ayuda('Estado de la conexión', AYUDA_SYNC);
  const ins = $('#insigniaCola');
  if (ins) { ins.hidden = !pend; ins.textContent = pend > 99 ? '99+' : pend; }
}

function alEventoSync(info) {
  if (info.tipo === 'rechazo') aviso('No se aplicó: ' + (info.mensaje || 'el servidor rechazó la operación') + ' (vea Cola).', 'error');
  if (info.tipo === 'parcial') refrescarSiCorresponde();
  if (info.tipo === 'libro') aviso('El sistema pasó al libro definitivo: se borraron los datos de prueba de este celular.');
  if (info.tipo === 'inicio') sincronizando = true;
  if (info.tipo === 'fin') { sincronizando = false; if (info.ok) { refrescarSiCorresponde(); revisarAvisos(); } else manejarErrorSync(info.error); }
  pintarEstado();
  if (info.tipo === 'cola' && /^#\/(cola|hoy|inicio)?$/.test(location.hash || '#/')) refrescarSiCorresponde();
}

function manejarErrorSync(e) {
  if (e && e.codigo === 'AUTH') { SESION_VENCIDA = true; mostrarReconectar(); pintarEstado(); }
  else if (e && e.codigo !== 'RED') aviso(e.message, 'error');
}

/**
 * Tras sincronizar se actualiza la pantalla SIN moverla: se conserva la posición, lo escrito
 * en los buscadores y el campo activo. Los formularios y las ventanas abiertas no se tocan.
 */
function refrescarSiCorresponde() {
  const h = location.hash || '#/';
  if ($('#modal')) return;
  if (REPINTAR) { try { REPINTAR(); } catch (e) { /* la vista se repinta en la próxima visita */ } return; }
  if (/^#\/(cobrar|corte|reactivar|nuevo|editar|asignar|config|plan|pausa|orden|negocio|ajustar|convenio\/|nuevoserv|editserv|nuevaorden|mapa|perfil|recordatorios)/.test(h)) return;   // no interrumpir un formulario
  const y = window.scrollY, act = document.activeElement, idAct = act && act.id;
  const valores = [...vista().querySelectorAll('input[id],select[id]')].filter((x) => x.type !== 'checkbox' && x.value).map((x) => [x.id, x.value]);
  Promise.resolve(enrutar({ conservar: true })).then(() => {
    valores.forEach(([id, v]) => { const x = document.getElementById(id); if (x && x.value !== v) { x.value = v; x.dispatchEvent(new Event(x.tagName === 'SELECT' ? 'change' : 'input')); } });
    if (idAct) { const x = document.getElementById(idAct); if (x && x.focus) x.focus({ preventScroll: true }); }
    window.scrollTo(0, y);
  });
}

/** Banner fijo cuando Google no renovó la sesión: un toque y sigue sincronizando (sin cerrar sesión). */
function mostrarReconectar() {
  let b = $('#reconectar');
  if (!b) {
    b = document.createElement('div'); b.id = 'reconectar'; b.className = 'reconectar'; b.setAttribute('role', 'alert');
    b.innerHTML = `<div class="rc-txt">${ic('alerta')}<div><b>Sesión vencida</b><small>Sus cambios están guardados en el celular. Toque el botón para seguir enviando y recibiendo datos.</small></div></div><div id="rcBoton"></div>`;
    $('#estado').after(b);
  }
  b.hidden = false;
  dibujarBoton($('#rcBoton'), 'continue_with');
}
function ocultarReconectar() { const b = $('#reconectar'); if (b) b.hidden = true; }

let _avisoT = null;
function aviso(msg, tipo = 'ok') {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast ' + tipo; el.hidden = false;
  clearTimeout(_avisoT); _avisoT = setTimeout(() => { el.hidden = true; }, 4500);
}

// ============================================================================
// RUTAS
// ============================================================================
function enrutar(op = {}) {
  const [ruta, arg] = (location.hash.replace(/^#\//, '') || 'inicio').split('/');
  RUTA = ruta;
  REPINTAR = null;
  document.querySelectorAll('nav.inferior a').forEach((a) => a.classList.toggle('activo', a.dataset.r === ruta));
  const v = { inicio: vInicio, buscar: vBuscar, cliente: vCliente, cobrar: vCobrar, recibo: vRecibo, cola: vCola,
    hoy: vHoy, cortar: vACortar, corte: vCorte, reactivar: vReactivar, cuenta: vCuenta, pago: vPago, ajustar: vAjustar, ecuenta: vEstadoCuenta, convenio: vConvenio, convenios: vConvenios, ordenserv: vOrdenServicio, nuevaorden: vNuevaOrden, nuevoserv: vNuevoServicio, editserv: vEditarServicio, plan: vCambiarPlan, pausa: vPausa, ordenes: vOrdenes, orden: vOrden, movimientos: vMovimientos, negocio: vNegocio,
    mas: vMas, mapa: vMapaGeneral, guia: vGuia, perfil: vPerfil, recordatorios: vRecordatorios, dashboard: vDashboard, config: vConfig, nuevo: vFormCliente, editar: vFormCliente, pppoe: vPPPoE, asignar: vAsignarPPPoE }[ruta] || vInicio;
  if (!op.conservar) { window.scrollTo(0, 0); cerrarModal(); }
  return Promise.resolve(v(decodeURIComponent(arg || ''))).catch((e) => { vista().innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}

// ---- INICIO ------------------------------------------------------------------------
/**
 * Tarjetas de acción con ícono de color (Inicio, Más, Perfil).
 * items: [{ href | id, icono, t, sub, color: azul|rojo|ambar|verde|violeta|gris|cian, cuenta, ayuda }]
 */
const tarjetasAccion = (items, clase = '') => `<div class="tarjetas-accion ${clase}">${items.filter(Boolean).map((x) => {
  const cuerpo = `<span class="ta-ic c-${x.color || 'azul'}">${ic(x.icono)}</span><span class="ta-txt"><b>${esc(x.t)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>
    ${x.cuenta ? `<span class="cuenta ${x.alerta ? 'alerta' : ''}">${esc(x.cuenta)}</span>` : ''}`;
  return x.href ? `<a class="tarjeta-accion" href="${x.href}">${cuerpo}</a>` : `<button class="tarjeta-accion" id="${x.id}">${cuerpo}</button>`;
}).join('')}</div>`;

// ---- INICIO: lo del día primero (cobrar, pendientes de hoy), luego cifras y accesos ----------
async function vInicio() {
  const res = Object.values(D.resumen);
  const n = (f) => res.filter(f).length;
  const deuda = res.reduce((s, r) => s + Number(r.DEUDA_VENCIDA || 0), 0);
  const hoy = await cobrosDeHoy();
  const aCortar = n((r) => /CORTAR/.test(r.ALERTA || ''));
  const ordenes = await ordenesLocales();
  ordenesLocales._cache = ordenes;
  const pendOt = ordenes.filter((o) => o.estado === 'Pendiente');
  const hoyISOv = hoyISO(), deHoy = pendOt.filter((o) => fechaOrden(o) === hoyISOv);
  const riesgo = (D.convenios || []).filter((v) => v.ESTADO === 'VIGENTE' && estadoConvenio(v).riesgo).length;
  const pend = (await pendientesDeEnvio()).length;
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  vista().innerHTML = `
    <div class="saludo"><p class="eyebrow">${esc(txtFecha(hoyISO()))}</p><h1>${saludo}, ${esc(String(PERFIL.nombre).split(' ')[0])}</h1></div>
    <a class="cta" href="#/buscar">${ic('cobrar')}<span class="txt"><b>Cobrar</b><small>Buscar cliente y registrar un pago</small></span>${ic('flecha', 'fin')}</a>
    <h3>Para hoy</h3>
    ${tarjetasAccion([
      { href: '#/ordenes', icono: 'lista', t: 'Órdenes', sub: deHoy.length ? `${deHoy.length} para hoy` : pendOt.length ? 'pendientes' : 'sin pendientes', color: 'azul', cuenta: pendOt.length || '', alerta: deHoy.length > 0 },
      { href: '#/cortar', icono: 'cortar', t: 'A cortar', sub: '30 días o más', color: 'rojo', cuenta: aCortar || '', alerta: aCortar > 0 },
      riesgo ? { href: '#/convenios', icono: 'calculadora', t: 'Convenios en riesgo', sub: 'cuotas atrasadas', color: 'ambar', cuenta: riesgo, alerta: true } : null,
      pend ? { href: '#/cola', icono: 'cola', t: 'Por enviar', sub: 'operaciones en cola', color: 'gris', cuenta: pend, alerta: true } : null,
    ], 'dos')}
    <section class="cifras" aria-label="Resumen">
      <div><span>Activos</span><b>${n((r) => r.ESTADO === 'Activo' || r.ESTADO === 'Moroso')}</b></div>
      <div class="peligro"><span>Morosos</span><b>${n((r) => r.ESTADO === 'Moroso')}</b></div>
      <div><span>Cortados</span><b>${n((r) => r.ESTADO === 'Cortado')}</b></div>
      <div class="ancho peligro"><span>Deuda vencida total</span><b>${soles(deuda)}</b></div>
      <a class="ancho ok" href="#/hoy"><span>Mis cobros de hoy · ${hoy.items.length} recibo(s)</span><b>${soles(hoy.total)}</b></a>
    </section>
    <h3>Accesos rápidos</h3>
    ${tarjetasAccion([
      { href: '#/nuevo', icono: 'nuevoCliente', t: 'Nuevo cliente', color: 'verde' },
      { href: '#/nuevaorden/libre', icono: 'documento', t: 'Nueva orden', color: 'azul' },
      { href: '#/mapa', icono: 'mapa', t: 'Mapa general', color: 'cian' },
      { href: '#/dashboard', icono: 'grafico', t: 'Dashboard', color: 'violeta' },
      { href: '#/movimientos', icono: 'reloj', t: 'Movimientos', color: 'cian' },
    ], 'dos')}
    <button class="btn secundario" id="btnSync">${ic('sync')}Sincronizar ahora</button>`;
  $('#btnSync').onclick = sincronizarManual;
  revisarAvisos();
}

/** Día programado de una orden (fecha del trabajo si la tiene; si no, el día que se creó). */
const fechaOrden = (o) => String((o.datos && o.datos.fecha) || o.fecha || '').slice(0, 10);

async function sincronizarManual() {
  if (!navigator.onLine) return aviso('Sin señal: los cobros quedan guardados y se enviarán solos.', 'error');
  try { await sincronizarTodo(); aviso('Datos actualizados.'); } catch (e) { manejarErrorSync(e); }
}

// ---- BUSCAR ------------------------------------------------------------------------
const ESTADOS_BUSCAR = [['', 'Todos'], ['Activo', 'Activo (al día)'], ['Moroso', 'Moroso'], ['ACORTAR', 'A cortar'], ['Suspendido', 'Suspendido'],
  ['Cortado', 'Cortado'], ['Baja', 'Baja'], ['CONVENIO', 'Con convenio'], ['DUO', 'Paquete DUO']];
async function vBuscar() {
  const f = Object.assign({ zona: '', estado: '' }, (await kvGet('filtrosBuscar')) || {});
  const zonas = [...new Set(D.clientes.map((c) => c.ZONA).filter(Boolean))].sort();
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  vista().innerHTML = `<input id="q" class="buscador" type="search" placeholder="Nombre, DNI, PPPoE, teléfono o ID" autocomplete="off" autofocus>
    <div class="filtros"><label>Zona<select id="fZona">${opt('', 'Todas', f.zona)}${zonas.map((z) => opt(z, z, f.zona)).join('')}</select></label>
      <label>Estado<select id="fEstado">${ESTADOS_BUSCAR.map(([v, t]) => opt(v, t, f.estado)).join('')}</select></label></div>
    <p class="sub" id="cuenta"></p>
    <ul id="res" class="lista"></ul>`;
  const cumple = (c) => {
    const r = D.resumen[c.ID_CLIENTE] || {};
    if (f.zona && c.ZONA !== f.zona) return false;
    if (!f.estado) return true;
    if (f.estado === 'ACORTAR') return /CORTAR/.test(r.ALERTA || '');
    if (f.estado === 'CONVENIO') return !!convenioAbierto(c.ID_CLIENTE);
    if (f.estado === 'DUO') return !!serviciosDuo(c.ID_CLIENTE);
    return r.ESTADO === f.estado;
  };
  const pintar = () => {
    const q = $('#q').value, filtrando = f.zona || f.estado;
    const lista = buscarClientes(q, q || filtrando ? 300 : 40, cumple);
    $('#cuenta').textContent = q || filtrando ? `${lista.length}${lista.length >= 300 ? '+' : ''} cliente(s)` : '';
    $('#res').innerHTML = lista.map((c) => {
      const r = D.resumen[c.ID_CLIENTE] || {};
      return `<li><a href="#/cliente/${esc(c.ID_CLIENTE)}">
        <div><b>${esc(c.NOMBRES)}</b><small>${esc(c.ID_CLIENTE)} · ${esc(c.ZONA)}${r.PPPOE ? ' · PPPoE ' + esc(r.PPPOE) : ''}</small></div>
        <div class="der"><span class="chip ${claseEstado(r.ESTADO)}">${esc(r.ESTADO || '-')}</span><small>${Number(r.DEUDA_VENCIDA) > 0 ? soles(r.DEUDA_VENCIDA) : ''}</small></div>
      </a></li>`;
    }).join('') || '<li class="vacio">Sin resultados</li>';
  };
  $('#q').addEventListener('input', pintar);
  ['#fZona', '#fEstado'].forEach((x) => { $(x).onchange = () => { f.zona = $('#fZona').value; f.estado = $('#fEstado').value; kvSet('filtrosBuscar', f); pintar(); }; });
  pintar();
}

// ---- FICHA DEL CLIENTE -------------------------------------------------------------
// ---- COMPONENTES DE PANTALLA (ayuda ⓘ, desplegables, menús) -------------------------------
/** Ícono ⓘ: al tocarlo abre una explicación corta (texto con \n para separar líneas). */
const ayuda = (titulo, texto, icono = 'info') => `<button type="button" class="info" data-ayuda="${esc(texto)}" data-titulo="${esc(titulo)}" aria-label="${esc(titulo)}">${ic(icono)}</button>`;
function verAyuda(titulo, texto) {
  const m = modal(`<h3 id="dlgT">${esc(titulo)}</h3><p class="mensaje">${esc(texto)}</p><button class="btn verde" id="ayOk">Entendido</button>`);
  prepararDialogo(m, () => {});
  m.querySelector('#ayOk').onclick = cerrarModal;
  m.querySelector('#ayOk').focus();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ayuda]');
  if (b) { e.preventDefault(); verAyuda(b.dataset.titulo, b.dataset.ayuda); }
});

/** Desplegable que recuerda si se dejó abierto (kv "secciones"). */
const seccion = (clave, titulo, html, cuenta) => `<details class="plegable" data-sec="${esc(clave)}"><summary><span>${esc(titulo)}${cuenta !== undefined ? ` <span class="cuenta">${cuenta}</span>` : ''}</span>${ic('abajo')}</summary><div class="plegable-cuerpo">${html}</div></details>`;
async function prepararSecciones(raiz) {
  const est = (await kvGet('secciones')) || {};
  raiz.querySelectorAll('details.plegable[data-sec]').forEach((d) => {
    if (est[d.dataset.sec]) d.open = true;
    d.addEventListener('toggle', async () => { const e = (await kvGet('secciones')) || {}; e[d.dataset.sec] = d.open; await kvSet('secciones', e); });
  });
}

/** Menú de opciones (hoja inferior con botones grandes). opciones: [{ t, icono, href | fn, clase }]. */
function menuOpciones(titulo, opciones) {
  const m = modal(`<h3 id="dlgT">${esc(titulo)}</h3><div class="menu-op">${opciones.map((o, i) => o.href
    ? `<a class="btn ${o.clase || ''}" href="${o.href}" data-i="${i}">${ic(o.icono || 'flecha')}${esc(o.t)}</a>`
    : `<button class="btn ${o.clase || ''}" data-i="${i}">${ic(o.icono || 'flecha')}${esc(o.t)}</button>`).join('')}</div>
    <button class="btn secundario" id="menuNo">Cerrar</button>`);
  prepararDialogo(m, () => {});
  m.querySelector('#menuNo').onclick = cerrarModal;
  m.querySelectorAll('[data-i]').forEach((b) => { b.addEventListener('click', () => { cerrarModal(); const o = opciones[b.dataset.i]; if (o.fn) o.fn(); }); });
}

/** Plan que ya trae TV (ej. "INTERNET 50 + CATV"): no se le agrega otro CATV aparte. */
const planIncluyeTV = (plan) => /INTERNET/i.test(plan) && /(CATV|CABLE|\bTV\b)/i.test(plan);
const esCatv = (s) => /CATV|CABLE/i.test(nombreServicio(s.PLAN)) && !/INTERNET/i.test(s.PLAN);

/** Meses de un pago en palabras cortas: "JUN 2026", "JUL 2026" (acepta fechas ISO, "06/2026" o "JUN-2026"). */
function mesesPago(txt) {
  const M = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
  return String(txt || '').split(/\s*[,;]\s*/).filter(Boolean).map((t) => {
    let m = /^(\d{4})-(\d{2})/.exec(t);
    if (m) return M[Number(m[2]) - 1] + ' ' + m[1];
    m = /^(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) return M[Number(m[1]) - 1] + ' ' + m[2];
    return t.replace(/-/g, ' ').toUpperCase();
  });
}
/** Ícono del método de pago: logo del banco o un ícono genérico. */
function icoMetodo(metodo) {
  const m = String(metodo || '');
  const banco = /yape/i.test(m) ? 'yape' : /bcp/i.test(m) ? 'bcp' : /naci[oó]n|\bbn\b/i.test(m) ? 'bn' : '';
  return banco ? `<img class="ico-banco" src="icons/bancos/${banco}-ico.png" alt="" width="32" height="32">`
    : `<span class="ico-metodo">${ic(/efectivo/i.test(m) ? 'cobrar' : 'enviado')}</span>`;
}

// ---- FICHA DEL CLIENTE -----------------------------------------------------------------------
// Siempre a la vista: deuda, Cobrar, Datos y Servicios. Lo demás en botones (estado de cuenta, contrato)
// o en desplegables (ajustes, pagos). Un paquete DUO se ve como UNA tarjeta.
async function vCliente(id) {
  const c = D.porId[id];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const r = D.resumen[id] || {};
  const duo = serviciosDuo(id);          // INTERNET + CATV: se muestran y cobran como uno
  const pagos = D.pagos.filter((p) => p.ID_CLIENTE === id).slice(-8).reverse();
  const enCola = (await colaTodos()).filter((o) => o.idCliente === id && o.estadoLocal !== 'ok' && o.estadoLocal !== 'rechazado');
  const servs = serviciosDe(id), vivos = servs.filter((s) => s.ESTADO !== 'Baja'), bajas = servs.filter((s) => s.ESTADO === 'Baja');
  const ajCli = (D.ajustes || []).filter((a) => a.ID_CLIENTE === id).slice(-6).reverse();
  const obs = String(c.OBSERVACIONES || '').trim();
  const enDuo = (s) => duo && duo.todos.some((x) => x.ID_SERV === s.ID_SERV);
  const sueltos = vivos.filter((s) => !enDuo(s));
  vista().innerHTML = `
    <section class="ficha">
      <h2>${esc(c.NOMBRES)}</h2>
      <p class="sub">${esc(id)} · DNI/RUC ${esc(c.DNI_RUC)} · <span class="chip ${claseEstado(r.ESTADO)}">${esc(r.ESTADO)}</span></p>
      <div class="deuda ${Number(r.DEUDA_VENCIDA) > 0 ? 'roja' : 'verde'}">
        <span>Deuda vencida</span><b>${soles(r.DEUDA_VENCIDA)}</b><small>${r.MESES_ADEUDA || 0} mes(es) · ${Number(r.DIAS_ATRASO) > 0 ? txtMora(r.DIAS_ATRASO) + ' de atraso' : 'al día'}${r.ALERTA ? ' · ' + esc(r.ALERTA) : ''}</small>
      </div>
      ${enCola.length ? `<p class="aviso">${ic('reloj')}<span>${enCola.length} operación(es) en cola de envío.</span></p>` : ''}
      <a class="btn grande verde" href="#/cobrar/${esc(id)}">${ic('cobrar')}Cobrar</a>
      <div class="botones">
        ${c.TELEFONO ? `<a class="btn" href="tel:${esc(c.TELEFONO)}">${ic('telefono')}Llamar</a>` : ''}
        <button class="btn" id="btnRecordatorio">${ic('chat')}Recordar</button>
        <a class="btn" href="#/ecuenta/${esc(id)}">${ic('grafico')}Cuenta</a>
        <a class="btn" href="#/ajustar/${esc(id)}">${ic('ajustes')}Ajustar</a>
        <button class="btn" id="btnConvenio">${ic('calculadora')}Convenio</button>
        <button class="btn" id="btnContrato">${ic('documento')}Contrato</button>
        <button class="btn" id="btnOrden">${ic('lista')}Orden</button>
        <a class="btn" href="#/editar/${esc(id)}">${ic('editar')}Editar</a>
      </div>
      <h3 class="tit-ic">Datos ${obs ? ayuda('Observaciones', obs, 'chat') : ''}<button type="button" class="info" id="btnClaves" aria-label="Ver claves WiFi / router">${ic('llave')}</button></h3>
      <dl class="datos">
        <dt>${ic('telefono')}<span class="sr">Teléfono</span></dt><dd>${esc(c.TELEFONO) || '—'}${c.TELEFONO2 ? ' / ' + esc(c.TELEFONO2) : ''}</dd>
        <dt>${ic('ubicacion')}<span class="sr">Dirección</span></dt><dd>${esc(c.DIRECCION) || '—'}${c.REFERENCIA ? ` <small>(${esc(c.REFERENCIA)})</small>` : ''}
          ${c.COORDENADAS ? ` <a class="enlace-mapa" href="https://maps.google.com/?q=${encodeURIComponent(c.COORDENADAS)}" target="_blank" rel="noopener">${ic('mapa')}Mapa</a>` : ''}</dd>
        <dt>${ic('mapa')}<span class="sr">Zona</span></dt><dd>${esc(c.ZONA) || '—'}</dd>
        <dt>${ic('reloj')}<span class="sr">Último pago</span></dt><dd>Último pago: ${esc(txtFecha(r.ULT_PAGO)) || '—'}</dd>
      </dl>
      <h3 class="tit-ic">Servicios <a class="mini" href="#/nuevoserv/${esc(id)}">${ic('agregar')}Agregar</a></h3>
      ${duo && duo.todos.some((s) => s.ESTADO !== 'Baja') ? tarjetaDuo(duo) : ''}
      ${sueltos.map((s) => tarjetaServicio(s)).join('')}
      ${!vivos.length ? (bajas.length ? `<p class="aviso">${ic('info')}<span>Cliente <b>dado de baja</b> (inactivo). Para volver a darle servicio toque <b>Reactivar</b> o use <b>Agregar</b>.</span></p>
        ${bajas.map((s) => tarjetaServicio(s)).join('')}` : `<p class="aviso">${ic('info')}<span>Cliente <b>inactivo</b>: no tiene ningún servicio registrado.</span></p>
        <a class="btn grande verde" href="#/nuevoserv/${esc(id)}">${ic('check')}Activar servicio</a>`)
        : bajas.length ? seccion('bajas', 'Servicios dados de baja', bajas.map((s) => tarjetaServicio(s)).join(''), bajas.length) : ''}
      ${bloqueConvenio(id, r)}
      <div id="otCliente"></div>
      ${ajCli.length ? seccion('ajustes', 'Ajustes de cuenta', `<ul class="lista compacta">${ajCli.map((a) => `<li><div><b>${esc(AJ_NOMBRE[a.TIPO] || a.TIPO)} · ${esc(txtPeriodo(a.PERIODO))}</b>
          <small>${esc(txtFecha(a.FECHA))} · ${esc(a.MOTIVO)}</small></div><div class="der">${soles(a.MONTO_ANTES)} → ${Number(a.MONTO_DESPUES) > 0 ? soles(a.MONTO_DESPUES) : 'anulado'}</div></li>`).join('')}</ul>`, ajCli.length) : ''}
      ${seccion('pagos', 'Últimos pagos', `<ul class="lista pagos">${pagos.map((p) => `<li class="${p.ESTADO === 'Anulado' ? 'anulado' : ''}"><a href="#/pago/${encodeURIComponent(p.N_RECIBO)}">
          ${icoMetodo(p.METODO)}<div><b>Pagado el ${esc(txtFecha(p.FECHA))}</b><small>${esc(p.N_RECIBO)} · ${esc(p.METODO)}${comentarioPago(p.OBS) ? ' · ' + ic('chat') + ' nota' : ''}</small>
            <span class="chips-meses">${mesesPago(p.PERIODOS).map((m) => `<span class="chip-mes">${esc(m)}</span>`).join('')}</span></div>
          <div class="der"><b class="monto">${soles(p.MONTO)}</b>${p.ESTADO === 'Anulado' ? '<small class="error">ANULADO</small>' : ''}</div></a></li>`).join('') || '<li class="vacio">Sin pagos recientes</li>'}</ul>
        <p class="sub">Toque un pago para ver el detalle, el PDF o anularlo.</p>`, pagos.length)}
    </section>`;
  prepararSecciones(vista());
  $('#btnRecordatorio').onclick = () => enviarWhatsApp(id, plantilla('MsgCobranza', id));
  // claves WiFi/router: se piden al servidor en el momento (no se guardan en el celular; queda registro de quién las vio)
  $('#btnClaves').onclick = async () => {
    const b = $('#btnClaves');
    if (!navigator.onLine) return aviso('Sin señal: las claves solo se consultan con internet.', 'error');
    b.disabled = true;
    try {
      const k = await llamar('clavesCliente', { idCliente: id });
      const txt = [k.USUARIO_WIFI || k.CLAVE_WIFI ? `WiFi: ${k.USUARIO_WIFI || '-'} / ${k.CLAVE_WIFI || '-'}` : '',
        k.USUARIO_ROUTER || k.CLAVE_ROUTER ? `Router: ${k.USUARIO_ROUTER || '-'} / ${k.CLAVE_ROUTER || '-'}` : ''].filter(Boolean).join('\n');
      verAyuda('Claves WiFi / router', txt || 'Este cliente no tiene claves registradas.');
    } catch (e) {
      aviso(e.message, 'error');
    } finally { b.disabled = false; }
  };
  $('#btnContrato').onclick = () => verContrato(id, r);
  $('#btnConvenio').onclick = () => {
    const tj = vista().querySelector('.servicio.convenio');        // convenio vigente o castigo: se muestra su tarjeta
    if (tj) { tj.scrollIntoView({ behavior: 'smooth', block: 'center' }); tj.classList.add('resaltar'); return; }
    if (!cargosDe(id).length) return aviso('No tiene montos pendientes para un convenio.', 'error');
    location.hash = '#/convenio/' + id;
  };
  $('#btnOrden').onclick = () => {
    if (!vivos.length) return aviso('Sin servicios: use Más → Órdenes → Orden libre.', 'error');
    const base = duo ? duo.internet[0] : null;
    if (vivos.length === 1 || base) { location.hash = '#/ordenserv/' + (base || vivos[0]).ID_SERV; return; }
    menuOpciones('¿Orden para qué servicio?', vivos.map((s) => ({ t: `${nombreServicio(s.PLAN)} · ${s.ESTADO}`, icono: esCatv(s) ? 'tv' : 'wifi', href: '#/ordenserv/' + s.ID_SERV })));
  };
  vista().querySelectorAll('[data-revertir]').forEach((b) => { b.onclick = () => revertirConvenio(b.dataset.revertir); });
  vista().querySelectorAll('[data-menu]').forEach((b) => { b.onclick = () => menuServicio(b.dataset.menu); });
  vista().querySelectorAll('[data-orden-corte]').forEach((b) => { b.onclick = () => ordenCorte(b.dataset.ordenCorte); });
  vista().querySelectorAll('[data-aviso-corte]').forEach((b) => { b.onclick = () => enviarWhatsApp(id, plantilla('MsgCorte', id)); });
  ordenesLocales().then((lista) => {
    const mias = lista.filter((o) => o.items.some((it) => it.idCliente === id)).slice(0, 10);
    const cont = $('#otCliente');
    if (!cont || !mias.length) return;
    const pend = mias.filter((o) => o.estado === 'Pendiente').length;
    cont.innerHTML = seccion('ordenes', 'Órdenes' + (pend ? ` (${pend} pendiente${pend > 1 ? 's' : ''})` : ''), `<ul class="lista">${mias.map((o) => { const it = o.items.find((x) => x.idCliente === id);
      return `<li><a href="#/orden/${encodeURIComponent(o.ref)}"><div><b>${esc(o.id)}</b> · ${esc(OT_NOMBRE[o.tipo] || o.tipo)}
        <small>${esc(txtFecha(o.fecha))} · ${esc(it.estado)}${it.obs ? ' · ' + esc(it.obs) : ''}</small></div>
        <div class="der"><span class="chip ${chipOt(o.estado)}">${esc(o.estado)}</span></div></a></li>`; }).join('')}</ul>`, mias.length);
    prepararSecciones(cont);
  });
}

/** Línea de detalle de un servicio: precio · modo · PPPoE (+ pausa). */
const lineaServicio = (s) => `${soles(s.TARIFA)}/mes · ${esc(s.MODO || 'sin modo')}${esCatv(s) ? '' : ' · PPPoE ' + esc(s.PPPOE || '-')}`;
const infoPausa = (s) => { const pa = pausaDe(s.ID_SERV); return pa ? `<small class="pausa-info">${ic('reloj')}Pausa ${esc(txtFecha(pa.F_INICIO))} → ${esc(txtFecha(pa.F_FIN))} · ${pa.ESTADO === 'Activa' ? 'en curso' : 'programada'}</small>` : ''; };

/** Botones principales según el estado (el resto va en "Más"). */
function botonesServicio(s, idMenu) {
  const b = [];
  if (s.ESTADO === 'Activo') b.push(`<a class="mini rojo" href="#/corte/${esc(s.ID_SERV)}">${ic('cortar')}Cortar</a>`);
  if ((s.ESTADO === 'Cortado' || s.ESTADO === 'Suspendido' || s.ESTADO === 'Baja') && !pausaDe(s.ID_SERV)) b.push(`<a class="mini verde" href="#/reactivar/${esc(s.ID_SERV)}">${ic('check')}Reactivar</a>`);
  if (s.ESTADO === 'Cortado') b.push(`<button class="mini" data-aviso-corte="1">${ic('chat')}Aviso</button>`);
  if (s.ESTADO !== 'Baja') b.push(`<a class="mini" href="#/ordenserv/${esc(s.ID_SERV)}">${ic('documento')}Orden</a>`);
  b.push(`<button class="mini" data-menu="${esc(idMenu || s.ID_SERV)}">${ic('puntos')}Más</button>`);
  return `<div class="acc-serv">${b.join('')}</div>`;
}

function tarjetaServicio(s) {
  return `<div class="servicio"><div class="serv-cab"><div><b>${esc(nombreServicio(s.PLAN))}</b> ${String(s.OBS || '').trim() ? ayuda('Nota del servicio', s.OBS, 'chat') : ''}
      <small>${lineaServicio(s)}</small><small class="tenue">${esc(s.ID_SERV)} · ${esc(s.PLAN)}</small>${infoPausa(s)}</div>
      <span class="chip ${claseEstado(s.ESTADO)}">${esc(s.ESTADO)}</span></div>
    ${botonesServicio(s)}</div>`;
}

/** Paquete DUO en una sola tarjeta; los dos servicios, en "Ver servicios". Las acciones van sobre el INTERNET (el corte ofrece los dos). */
function tarjetaDuo(duo) {
  const vivos = duo.todos.filter((s) => s.ESTADO !== 'Baja'), base = duo.internet[0] || vivos[0];
  const estados = [...new Set(vivos.map((s) => s.ESTADO))];
  const total = vivos.reduce((t, s) => t + Number(s.TARIFA || 0), 0);
  return `<div class="servicio duo"><div class="serv-cab"><div><b>Paquete DUO ${ayuda('Paquete DUO', 'Internet y TV cable se cobran juntos, un mes = los dos servicios.\nAl cortar o reactivar se ofrecen los dos marcados.\nPara dejar solo uno: Cortar → Baja definitiva del que se quita (pide el nuevo precio del que queda).\nEl PPPoE es del INTERNET: cortar solo el CATV no lo toca.')}</b>
      <small>${vivos.map((s) => esc(nombreCorto({ CONCEPTO: 'MENSUALIDAD', PLAN: s.PLAN })) + ' ' + soles(s.TARIFA)).join(' + ')} = <b>${soles(total)}</b>/mes</small>
      <small>${esc(base.MODO || 'sin modo')} · PPPoE ${esc(base.PPPOE || '-')}</small>${vivos.map(infoPausa).join('')}</div>
      <span class="estados">${estados.map((e) => `<span class="chip ${claseEstado(e)}">${esc(e)}</span>`).join('')}</span></div>
    ${botonesServicio(base, base.ID_SERV)}
    <details class="sub-serv"><summary>Ver los ${vivos.length} servicios ${ic('abajo')}</summary>
      ${vivos.map((s) => `<div class="serv-linea"><div><b>${esc(nombreServicio(s.PLAN))}</b> ${String(s.OBS || '').trim() ? ayuda('Nota del servicio', s.OBS, 'chat') : ''}<small>${lineaServicio(s)} · ${esc(s.ID_SERV)}</small></div>
        <span class="chip ${claseEstado(s.ESTADO)}">${esc(s.ESTADO)}</span><button class="mini" data-menu="${esc(s.ID_SERV)}" aria-label="Opciones de ${esc(nombreServicio(s.PLAN))}">${ic('puntos')}</button></div>`).join('')}
    </details></div>`;
}

/** "Más": todas las acciones de UN servicio. */
function menuServicio(idServ) {
  const s = servicioPorId(idServ);
  if (!s) return;
  const id = s.ID_CLIENTE, pa = pausaDe(s.ID_SERV), duo = serviciosDuo(id);
  const op = [];
  if (s.ESTADO === 'Activo') {
    op.push({ t: 'Cambiar plan o precio', icono: 'ajustes', href: '#/plan/' + s.ID_SERV });
    if (!pa) op.push({ t: 'Pausa vacacional', icono: 'reloj', href: '#/pausa/' + s.ID_SERV });
    op.push({ t: 'Corte, suspensión o baja', icono: 'cortar', href: '#/corte/' + s.ID_SERV, clase: 'rojo' });
    op.push({ t: 'Orden de corte (técnico)', icono: 'documento', fn: () => ordenCorte(s.ID_SERV) });
    if (!esCatv(s) && !s.PPPOE) op.push({ t: 'Asignar PPPoE', icono: 'router', href: '#/asignar/' + s.ID_SERV });
    if (!duo && /INTERNET/i.test(s.PLAN) && !planIncluyeTV(s.PLAN)) op.push({ t: 'Agregar TV cable (paquete DUO)', icono: 'agregar', href: '#/nuevoserv/' + id });
  }
  if (pa) op.push({ t: pa.ESTADO === 'Activa' ? 'Terminar pausa hoy' : 'Cancelar pausa', icono: 'reloj', fn: () => terminarPausa(s.ID_SERV) });
  if ((s.ESTADO === 'Cortado' || s.ESTADO === 'Suspendido' || s.ESTADO === 'Baja') && !pa) op.push({ t: s.ESTADO === 'Baja' ? 'Volver a activar (cliente que regresa)' : 'Reactivar', icono: 'check', href: '#/reactivar/' + s.ID_SERV, clase: 'verde' });
  if (s.ESTADO !== 'Baja') op.push({ t: 'Orden de servicio (visita técnica)', icono: 'documento', href: '#/ordenserv/' + s.ID_SERV });
  op.push({ t: 'Corregir datos del servicio (modo, nombre, nota)', icono: 'editar', href: '#/editserv/' + s.ID_SERV });
  menuOpciones(`${nombreServicio(s.PLAN)} · ${s.ID_SERV}`, op);
}

/** Orden de corte: en un paquete DUO lleva los dos servicios (se corta al cliente completo). */
async function ordenCorte(idServ) {
  const sv = servicioPorId(idServ), id = sv.ID_CLIENTE, r = D.resumen[id] || {}, duo = serviciosDuo(id);
  const servs = duo && duo.todos.some((s) => s.ID_SERV === sv.ID_SERV) ? duo.todos.filter((s) => s.ESTADO === 'Activo') : [sv];
  const pend = (await ordenesLocales()).some((o) => o.estado === 'Pendiente' && o.tipo !== 'CAMBIO_PLAN' &&
    o.items.some((it) => servs.some((s) => s.ID_SERV === it.idServ) && it.estado === 'Pendiente'));
  if (pend) return aviso('Este servicio ya tiene un corte pendiente (orden u hoja de ruta).', 'error');
  if (!(await confirmar(`${sv.CLIENTE} · ${servs.map((s) => s.ID_SERV + ' ' + nombreServicio(s.PLAN)).join(' + ')}\nDeuda: ${soles(r.DEUDA_VENCIDA)}. El corte se registra cuando el técnico la marque como "Cortado".`,
    { titulo: '¿Generar orden de corte?', si: 'Generar orden' }))) return;
  const op = { tipo: 'CREAR_ORDEN', datos: { tipo: 'ORDEN_CORTE', items: servs.map((s) => ({ idServ: s.ID_SERV, idCliente: id })) },
    vista: { tipo: 'ORDEN_CORTE', datos: {}, items: servs.map((s) => ({ idServ: s.ID_SERV, idCliente: id, snap: snapshotLocal(id, s.ID_SERV) })) } };
  await encolar(op);
  aviso(navigator.onLine ? 'Orden de corte enviada.' : 'Orden guardada sin señal: ya puede imprimirla.');
  location.hash = '#/orden/' + op.idSolicitud;
}

async function terminarPausa(idServ) {
  const pa = pausaDe(idServ), s = servicioPorId(idServ), enCurso = pa.ESTADO === 'Activa';
  if (!(await confirmar(enCurso ? `El servicio vuelve a Activo hoy. Los días no usados (hasta el ${txtFecha(pa.F_FIN)}) se vuelven a cobrar.`
    : `Se cancela la pausa del ${txtFecha(pa.F_INICIO)} al ${txtFecha(pa.F_FIN)} y se quita su descuento. No cuenta para el límite del año.`,
    { titulo: enCurso ? '¿Terminar la pausa hoy?' : '¿Cancelar la pausa?', si: enCurso ? 'Terminar pausa' : 'Cancelar pausa', no: 'Volver' }))) return;
  await encolar({ tipo: 'TERMINAR_PAUSA', idServ, idCliente: s.ID_CLIENTE, fecha: hoyISO(), motivo: enCurso ? 'Volvió antes' : 'Pausa cancelada' });
  aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
}

/** Botón "Contrato": renovación anual (solo sin deuda vencida; el servidor vuelve a comprobarlo). */
function verContrato(id, r) {
  const c = D.porId[id], activos = serviciosDe(id).filter((s) => s.ESTADO === 'Activo');
  const anio = Number(hoyISO().slice(0, 4)) + 1, idsServ = new Set(activos.map((s) => s.ID_SERV));
  const anios = [...new Set(D.cargos.filter((k) => idsServ.has(k.ID_SERV) && k.CONCEPTO === 'MENSUALIDAD').map((k) => String(k.PERIODO).slice(0, 4)))].sort();
  const yaTiene = anios.includes(String(anio)), deuda = Number(r.DEUDA_VENCIDA) || 0;
  const puede = activos.length && !yaTiene && !(deuda > 0);
  const motivo = !activos.length ? 'No tiene servicios activos.' : yaTiene ? `El contrato ${anio} ya está renovado.`
    : deuda > 0 ? `Se habilita cuando no tenga deuda vencida (debe ${soles(deuda)}).` : `Genera las cuotas de ENE a DIC ${anio}.`;
  const m = modal(`<h3 id="dlgT">Contrato</h3><p class="sub">${esc(c.NOMBRES)}</p>
    <dl><dt>Servicios activos</dt><dd>${activos.map((s) => esc(nombreServicio(s.PLAN)) + ' ' + soles(s.TARIFA)).join(' + ') || '—'}</dd>
      <dt>Años con cuotas</dt><dd>${esc(anios.join(', ') || '—')}</dd></dl>
    <p class="aviso">${ic('documento')}<span>${esc(motivo)}</span></p>
    <div class="acciones"><button class="btn" id="ctNo">Cerrar</button><button class="btn verde" id="ctSi" ${puede ? '' : 'disabled aria-disabled="true"'}>Renovar ${anio}</button></div>`);
  prepararDialogo(m, () => {});
  m.querySelector('#ctNo').onclick = cerrarModal;
  m.querySelector('#ctSi').onclick = async () => {
    cerrarModal();
    if (!(await confirmar(`Se generarán las cuotas de ENE a DIC ${anio} para los servicios activos de ${c.NOMBRES}.`, { titulo: `¿Renovar contrato ${anio}?`, si: 'Renovar' }))) return;
    await encolar({ tipo: 'RENOVAR_ANIO', idCliente: id, datos: { anio } });
    aviso(navigator.onLine ? 'Renovación enviada.' : 'Guardada: se enviará al volver la señal.');
  };
}

/** Estado de cuenta en pantalla aparte (#/ecuenta/ID): matriz mes × servicio. */
function vEstadoCuenta(id) {
  const c = D.porId[id];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const r = D.resumen[id] || {};
  vista().innerHTML = `<section class="ficha"><a class="volver" href="#/cliente/${esc(id)}">${ic('atras')}Volver a la ficha</a>
    <h2>${esc(c.NOMBRES)}</h2><p class="sub">${esc(id)} · deuda vencida ${soles(r.DEUDA_VENCIDA)}</p>
    <section id="ecuenta" class="ecuenta"><h3>Estado de cuenta</h3><p class="sub">Cargando…</p></section></section>`;
  cargarCuenta(id).then((cu) => pintarCuenta($('#ecuenta'), id, cu)).catch(() => {});
}

// ---- AGREGAR SERVICIO (con su modo) y CORREGIR DATOS DE UN SERVICIO ---------------------------
/** Opciones de modo: los activos del catálogo + el actual si ya no está. */
const opcionesModo = (actual) => [...new Set([...lst('MODO'), actual].filter(Boolean))]
  .map((m) => `<option ${m === actual ? 'selected' : ''}>${esc(m)}</option>`).join('');

function vNuevoServicio(idCli) {
  const c = D.porId[idCli];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const vivos = serviciosDe(idCli).filter((s) => s.ESTADO !== 'Baja');
  const inet = vivos.find((s) => /INTERNET/i.test(s.PLAN) && !esCatv(s));
  const tieneTV = vivos.some((s) => esCatv(s) || planIncluyeTV(s.PLAN));
  const planes = D.planes.filter((p) => p.ACTIVO !== 'No');
  // sugerencia: si tiene solo internet, lo natural es agregar el CATV (paquete DUO)
  const sug = inet && !tieneTV ? planes.find((p) => /CATV|CABLE/i.test(nombreServicio(p.PLAN)) && !/INTERNET/i.test(p.PLAN)) : null;
  const modoBase = (inet || vivos[0] || {}).MODO || '';
  vista().innerHTML = `<section class="form"><h2>${vivos.length ? 'Agregar servicio' : 'Activar servicio'}</h2>
    <p class="sub">${esc(c.NOMBRES)} · ${esc(idCli)}${vivos.length ? ' · ya tiene ' + vivos.map((s) => esc(nombreCorto({ CONCEPTO: 'MENSUALIDAD', PLAN: s.PLAN }))).join(' + ') : ''}</p>
    <label>Plan *<select id="ns_plan"><option value="">— elegir —</option>${planes.map((p) => `<option data-t="${Number(p.TARIFA)}" ${sug && p.PLAN === sug.PLAN ? 'selected' : ''}>${esc(p.PLAN)}</option>`).join('')}</select></label>
    <label>Precio (S/ al mes) *<input id="ns_tarifa" type="number" step="0.10" inputmode="decimal" value="${sug ? Number(sug.TARIFA) : ''}"></label>
    <label class="tit-ic">Modo / equipo * ${ayuda('Modo / equipo', 'Indica cómo está instalado el servicio (ONU, antena, DUO+CATV…).\nSi el cliente tiene internet y TV, use el mismo modo en los dos.\nLa lista se edita en Más → Configuración.')}
      <select id="ns_modo"><option value=""></option>${opcionesModo(modoBase)}</select></label>
    <div id="ns_pppWrap"><span class="etq">PPPoE del internet</span>${campoPPPoE('ns_ppp', '', { titulo: 'PPPoE del internet' })}</div>
    <label class="check" id="ns_igualWrap" hidden><input type="checkbox" id="ns_igual" checked> Poner este modo también en los otros servicios del cliente</label>
    <label>Inicio del servicio<input id="ns_fecha" type="date" value="${hoyISO()}"></label>
    <p class="aviso" id="ns_nota" hidden></p>
    <button class="btn grande verde" id="ok">${ic('check')}Agregar servicio</button>
    <a class="btn secundario" href="#/cliente/${esc(idCli)}">Cancelar</a></section>`;
  const pintar = () => {
    const plan = $('#ns_plan').value, modo = $('#ns_modo').value;
    const otrosDistintos = vivos.filter((s) => s.MODO !== modo);
    $('#ns_pppWrap').hidden = !plan || esCatv({ PLAN: plan });          // el PPPoE es del internet
    $('#ns_igualWrap').hidden = !modo || !otrosDistintos.length;
    const notas = [];
    if (plan && esCatv({ PLAN: plan }) && inet) notas.push(`Quedará como paquete DUO con ${nombreServicio(inet.PLAN)} ${soles(inet.TARIFA)}: se cobran y cortan juntos. El PPPoE sigue en el internet.`);
    if (plan && tieneTV && (esCatv({ PLAN: plan }) || planIncluyeTV(plan))) notas.push('Ojo: el cliente ya tiene TV. Revise que no se duplique.');
    if (plan) notas.push('El primer mes se cobra por los días que quedan.');
    $('#ns_nota').hidden = !notas.length;
    $('#ns_nota').innerHTML = `${ic('info')}<span>${notas.map(esc).join('<br>')}</span>`;
  };
  $('#ns_plan').onchange = (e) => { const o = e.target.selectedOptions[0]; $('#ns_tarifa').value = o && o.dataset.t ? o.dataset.t : ''; pintar(); };
  $('#ns_modo').onchange = pintar;
  pintar();
  $('#ok').onclick = async () => {
    const plan = $('#ns_plan').value, tarifa = r2(Number($('#ns_tarifa').value || 0)), modo = $('#ns_modo').value, fecha = $('#ns_fecha').value;
    if (!plan) return aviso('Elija el plan.', 'error');
    if (!(tarifa > 0)) return aviso('El precio debe ser mayor a 0.', 'error');
    if (!modo) return aviso('Elija el modo / equipo.', 'error');
    if (!fecha) return aviso('Elija la fecha de inicio.', 'error');
    const igualar = !$('#ns_igualWrap').hidden && $('#ns_igual').checked ? vivos.filter((s) => s.MODO !== modo) : [];
    if (!(await confirmar(`${c.NOMBRES}\n${plan} · ${soles(tarifa)}/mes · ${modo}\nDesde ${txtFecha(fecha)}` +
      (!$('#ns_pppWrap').hidden && $('#ns_ppp').value ? `\nPPPoE ${$('#ns_ppp').value}` : '') +
      (igualar.length ? `\nModo "${modo}" también en: ${igualar.map((s) => nombreServicio(s.PLAN)).join(', ')}` : ''), { titulo: '¿Agregar el servicio?', si: 'Agregar' }))) return;
    const ppp = $('#ns_pppWrap').hidden ? '' : $('#ns_ppp').value;
    await encolar({ tipo: 'NUEVO_SERVICIO', idCliente: idCli, plan, tarifa, modo, fecha, codigoPPPoE: ppp });
    for (const s of igualar) await encolar({ tipo: 'EDITAR_SERVICIO', idServ: s.ID_SERV, idCliente: idCli, modo, datos: {} });
    aviso(navigator.onLine ? 'Enviado. El servicio aparecerá en segundos.' : 'Guardado: se enviará al volver la señal.');
    location.hash = '#/cliente/' + idCli;
  };
}

function vEditarServicio(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  const planes = D.planes.filter((p) => p.ACTIVO !== 'No' || p.PLAN === s.PLAN);
  vista().innerHTML = `<section class="form"><h2>Corregir datos del servicio</h2>
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${soles(s.TARIFA)}/mes · ${esc(s.ESTADO)}</p>
    <p class="aviso">${ic('info')}<span>No cambia precios ni deuda. Para cambiar el precio use <b>Cambiar plan</b>.</span></p>
    <label>Plan<select id="es_plan">${planes.map((p) => `<option ${p.PLAN === s.PLAN ? 'selected' : ''}>${esc(p.PLAN)}</option>`).join('')}
      ${planes.some((p) => p.PLAN === s.PLAN) ? '' : `<option selected>${esc(s.PLAN)}</option>`}</select></label>
    <label>Modo / equipo<select id="es_modo"><option value="">— sin modo —</option>${opcionesModo(s.MODO)}</select></label>
    <label>Nota del servicio<textarea id="es_obs" rows="3">${esc(s.OBS || '')}</textarea></label>
    <button class="btn grande verde" id="ok">${ic('check')}Guardar</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  $('#ok').onclick = async () => {
    const plan = $('#es_plan').value, modo = $('#es_modo').value, obs = $('#es_obs').value.trim();
    const op = { tipo: 'EDITAR_SERVICIO', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, datos: {} }, cambios = [];
    if (plan !== s.PLAN) { op.plan = plan; cambios.push(`Plan: ${s.PLAN} → ${plan}`); }
    if (modo && modo !== (s.MODO || '')) { op.modo = modo; cambios.push(`Modo: ${s.MODO || '-'} → ${modo}`); }
    if (obs !== String(s.OBS || '').trim()) { op.datos.obs = obs; cambios.push('Nota actualizada'); }
    if (!cambios.length) return aviso('No hay cambios.', 'error');
    if (!(await confirmar(cambios.join('\n'), { titulo: '¿Guardar los cambios?', si: 'Guardar' }))) return;
    await encolar(op);
    aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

// ---- COBRAR ------------------------------------------------------------------------
async function vCobrar(id) {
  const c = D.porId[id];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  // cargos que ya están en cola sin enviar: no se ofrecen otra vez
  const enCola = new Set((await colaTodos()).filter((o) => o.tipo === 'COBRO' && ['pendiente', 'enviado', 'error'].includes(o.estadoLocal))
    .flatMap((o) => o.cargos || []));
  const hoyMes = hoyISO().slice(0, 7);
  const todos = cargosDe(id).filter((k) => !enCola.has(k.ID_CARGO));
  // Un cliente con INTERNET y CATV (dos servicios) se cobra como uno: una fila por MES que marca ambos.
  // "Cobrar solo uno" muestra cada servicio por separado (ej.: pagó solo el internet).
  const pagadoTxt = (k) => (Number(k.PAGADO) > 0 ? ' · pagado ' + soles(k.PAGADO) : '');
  const filaCargo = (k, marcado, hijo) => `<label class="cargo ${hijo ? 'hijo' : ''}">
      <input type="checkbox" value="${esc(k.ID_CARGO)}" data-saldo="${Number(k.SALDO)}" ${marcado ? 'checked' : ''}>
      <span class="per">${hijo ? esc(nombreCorto(k)) : esc(txtPeriodo(k.PERIODO))}</span>
      <span class="det">${hijo ? esc(txtPeriodo(k.PERIODO)) : esc(nombreCargo(k))}${pagadoTxt(k)}</span>
      <span class="chip ${claseEstado(k.ESTADO)}">${esc(k.ESTADO)}</span>
      <b>${soles(k.SALDO)}</b></label>`;
  const gravedad = ['Vencido', 'Parcial', 'Por vencer', 'Pendiente'];
  const rango = (e) => (gravedad.indexOf(e) + 1) || 99;
  const peor = (l) => l.map((k) => k.ESTADO).sort((a, b) => rango(a) - rango(b))[0];   // el chip del mes muestra el estado más grave
  const meses = [];
  todos.forEach((k) => {
    const ym = String(k.PERIODO).slice(0, 7), u = meses[meses.length - 1];
    if (u && u.ym === ym) u.cargos.push(k); else meses.push({ ym, cargos: [k] });
  });
  const grupo = (g, n) => {
    const futuro = g.ym > hoyMes, marcado = !futuro;   // por defecto: vencidos y del mes
    const attrs = `class="mes-grupo ${futuro ? 'futuro' : ''}" ${futuro ? 'data-futuro="1"' : ''}`;
    if (g.cargos.length === 1) return `<div ${attrs}>${filaCargo(g.cargos[0], marcado, false)}</div>`;
    const saldo = r2(g.cargos.reduce((s, k) => s + Number(k.SALDO), 0)), est = peor(g.cargos);
    return `<div ${attrs}>
      <label class="cargo">
        <input type="checkbox" class="todo-mes" ${marcado ? 'checked' : ''} aria-label="Todo ${esc(txtPeriodo(g.ym))}">
        <span class="per">${esc(txtPeriodo(g.ym))}</span>
        <span class="det">${g.cargos.map((k) => esc(nombreCorto(k)) + ' ' + soles(k.SALDO).slice(3)).join(' + ')}</span>
        <span class="chip ${claseEstado(est)}">${esc(est)}</span>
        <b>${soles(saldo)}</b></label>
      <div class="hijos" id="hijos${n}" hidden>${g.cargos.map((k) => filaCargo(k, marcado, true)).join('')}</div>
    </div>`;
  };
  const hayGrupos = meses.some((g) => g.cargos.length > 1);
  vista().innerHTML = `
    <section class="cobro">
      <h2>Cobrar · ${esc(c.NOMBRES)}</h2>
      <p class="sub">${esc(id)} · ${esc(c.ZONA)}</p>
      ${enCola.size ? '<p class="aviso">Hay meses de este cliente en la cola de envío; no se muestran para no cobrarlos dos veces.</p>' : ''}
      <div class="acciones-sel">
        <button type="button" class="mini" id="selVenc">Vencidos</button>
        <button type="button" class="mini" id="selTodo">Todo</button>
        <button type="button" class="mini" id="selNada">Ninguno</button>
        <label class="mini check"><input type="checkbox" id="verFut"> Adelantar meses</label>
        ${hayGrupos ? '<label class="mini check"><input type="checkbox" id="porServ"> Ver por servicio</label>' : ''}
      </div>
      ${hayGrupos ? '<p class="sub">Cada mes cobra INTERNET y CATV juntos. Si paga solo uno, marque "Ver por servicio".</p>' : ''}
      <div id="cargos" class="cargos">${meses.map(grupo).join('') || '<p class="vacio">No tiene meses pendientes.</p>'}</div>
      <div class="total">Seleccionado: <b id="tSel">S/ 0.00</b></div>
      <label>Monto recibido (S/)<input id="monto" type="number" inputmode="decimal" step="0.10" min="0"></label>
      <p id="avisoMonto" class="aviso" hidden></p>
      <label>Método<select id="metodo">${metodosPago().map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label id="opWrap">N° de operación<input id="operacion" inputmode="numeric" autocomplete="off"></label>
      <label id="fotoWrap" class="foto"><span class="etq-ic">${ic('camara')}Foto del voucher (opcional)</span>
        <input id="foto" type="file" accept="image/*" capture="environment"></label>
      <img id="fotoPrev" class="foto-prev" hidden alt="Voucher">
      <label>Observación<input id="obs" maxlength="200" placeholder="Opcional (ej.: pagó solo el cable)"></label>
      <button class="btn grande verde" id="btnCobrar">${ic('check')}Registrar cobro</button>
      <a class="btn secundario" href="#/cliente/${esc(id)}">Cancelar</a>
    </section>`;
  // cajas = una por cargo (las de los servicios); las casillas "todo el mes" solo marcan sus cargos
  const cajas = () => [...document.querySelectorAll('#cargos input[data-saldo]')];
  const visibles = () => cajas().filter((x) => !x.closest('.mes-grupo').hidden);
  const gruposFut = () => [...document.querySelectorAll('#cargos .mes-grupo[data-futuro]')];
  const futuros = () => cajas().filter((x) => x.closest('.mes-grupo').dataset.futuro);
  const sincronizarMeses = () => document.querySelectorAll('#cargos .todo-mes').forEach((m) => {
    const hs = [...m.closest('.mes-grupo').querySelectorAll('input[data-saldo]')], n = hs.filter((x) => x.checked).length;
    m.checked = n === hs.length; m.indeterminate = n > 0 && n < hs.length;
  });
  gruposFut().forEach((g) => { g.hidden = true; });
  futuros().forEach((x) => { x.checked = false; });
  sincronizarMeses();
  const total = () => r2(visibles().filter((x) => x.checked).reduce((s, x) => s + Number(x.dataset.saldo), 0));
  const recalc = (ponerMonto = true) => {
    sincronizarMeses();
    const t = total();
    $('#tSel').textContent = soles(t);
    if (ponerMonto) $('#monto').value = t ? t.toFixed(2) : '';
    validarMonto();
  };
  const validarMonto = () => {
    const t = total(), m = r2($('#monto').value || 0), a = $('#avisoMonto');
    a.hidden = true; a.className = 'aviso';
    if (m > t + 0.004) { a.hidden = false; a.classList.add('error'); a.textContent = 'El monto supera lo seleccionado. Marque más meses (o "Adelantar meses").'; }
    else if (m > 0 && m < t - 0.004) { a.hidden = false; a.textContent = `PAGO PARCIAL: quedará un saldo de ${soles(t - m)} (se aplica del mes más antiguo al más nuevo).`; }
  };
  $('#cargos').addEventListener('change', (e) => {
    if (e.target.classList.contains('todo-mes'))
      e.target.closest('.mes-grupo').querySelectorAll('input[data-saldo]').forEach((x) => { x.checked = e.target.checked; });
    recalc();
  });
  if ($('#porServ')) $('#porServ').onchange = (e) => {
    document.querySelectorAll('#cargos .hijos').forEach((h) => { h.hidden = !e.target.checked; });
  };
  $('#monto').addEventListener('input', validarMonto);
  $('#selVenc').onclick = () => { visibles().forEach((x) => { x.checked = !x.closest('.mes-grupo').dataset.futuro; }); recalc(); };
  $('#selTodo').onclick = () => { visibles().forEach((x) => { x.checked = true; }); recalc(); };
  $('#selNada').onclick = () => { cajas().forEach((x) => { x.checked = false; }); recalc(); };
  $('#verFut').onchange = (e) => {
    gruposFut().forEach((g) => { g.hidden = !e.target.checked; });
    if (!e.target.checked) futuros().forEach((x) => { x.checked = false; });
    recalc();
  };
  $('#metodo').onchange = () => {
    const ef = $('#metodo').value === 'Efectivo';
    $('#opWrap').style.display = ef ? 'none' : ''; $('#fotoWrap').style.display = ef ? 'none' : '';
  };
  let fotoData = '';
  $('#foto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { fotoData = await comprimirImagen(f); $('#fotoPrev').src = fotoData; $('#fotoPrev').hidden = false; }
    catch (err) { aviso('No se pudo leer la foto.', 'error'); }
  };
  $('#metodo').onchange();
  recalc();

  $('#btnCobrar').onclick = async () => {
    const sel = visibles().filter((x) => x.checked);
    const monto = r2($('#monto').value || 0), t = total(), metodo = $('#metodo').value;
    if (!sel.length) return aviso('Marque al menos un mes.', 'error');
    if (!(monto > 0)) return aviso('Ingrese el monto recibido.', 'error');
    if (monto > t + 0.004) return aviso('El monto supera lo seleccionado.', 'error');
    if (metodo !== 'Efectivo' && !$('#operacion').value.trim() &&
        !(await confirmar(`No ingresó N° de operación de ${metodo}.`, { titulo: '¿Registrar de todos modos?', si: 'Registrar' }))) return;
    // mismo orden que el servidor: por mes y, dentro del mes, INTERNET antes que CATV
    const cargosSel = D.cargos.filter((k) => sel.some((x) => x.value === k.ID_CARGO)).sort(ordenCargos);
    const reparto = repartir(cargosSel, monto);
    const lineas = agruparLineas(reparto.map((x) => ({ per: String(x.cargo.PERIODO).slice(0, 7), base: nombreCargo(x.cargo), monto: x.aplicado, parcial: x.parcial })));
    if (!(await confirmar(`${c.NOMBRES}\nMétodo: ${metodo}\n` +
        lineas.map((l) => `· ${l.periodo} ${l.detalle}: ${soles(l.monto)}${l.parcial ? ' (parcial)' : ''}`).join('\n'),
        { titulo: `Registrar ${soles(monto)}${monto < t - 0.004 ? ' (parcial)' : ''}`, si: 'Registrar cobro' }))) return;
    $('#btnCobrar').disabled = true;
    const op = {
      tipo: 'COBRO', idCliente: id, cargos: cargosSel.map((k) => k.ID_CARGO), monto, metodo,
      operacion: $('#operacion').value.trim(), obs: $('#obs').value.trim(), fechaPago: hoyISO(),
      foto: metodo === 'Efectivo' ? '' : fotoData,
      reciboProvisional: await siguienteProvisional(PERFIL.iniciales),
      // copia para mostrar el comprobante aunque no haya señal
      vista: { cliente: c.NOMBRES, doc: c.DNI_RUC, zona: c.ZONA, telefono: c.TELEFONO, usuario: PERFIL.nombre,
        detalle: reparto.map((x) => ({ periodo: txtPeriodo(x.cargo.PERIODO), per: String(x.cargo.PERIODO).slice(0, 7), concepto: nombreCargo(x.cargo),
          aplicado: x.aplicado, parcial: x.parcial })),
        saldoAntes: Number((D.resumen[id] || {}).DEUDA_TOTAL || 0) },
    };
    await encolar(op);
    location.hash = '#/recibo/' + op.idSolicitud;
  };
}

// ---- RECIBO (provisional u oficial) ------------------------------------------------
async function vRecibo(idSol) {
  const op = (await colaTodos()).find((o) => o.idSolicitud === idSol);
  if (!op) { vista().innerHTML = '<p class="error">Recibo no encontrado.</p>'; return; }
  const v = op.vista || {}, res = op.resultado || {};
  const oficial = op.estadoLocal === 'ok' && res.nroRecibo;
  const nro = oficial ? res.nroRecibo : op.reciboProvisional;
  const rech = op.estadoLocal === 'rechazado';
  const cfg = D.config;
  // meses seguidos del mismo servicio en una línea, igual que el recibo PDF ("SERVICIO DE INTERNET · 3 meses")
  const lineas = agruparLineas((v.detalle || []).map((d) => ({ per: d.per, periodo: d.periodo, base: nombreServicio(d.concepto), monto: d.aplicado, parcial: d.parcial })));
  const texto = `*${cfg.Negocio || 'D@NDINET'}* — ${oficial ? 'RECIBO DE PAGO' : 'RECIBO PROVISIONAL'} ${nro}\n` +
    `Fecha: ${txtFecha(op.fechaPago)}\nCliente: ${v.cliente}\n` +
    lineas.map((d) => `• ${d.periodo} ${d.detalle}: ${soles(d.monto)}${d.parcial ? ' (parcial)' : ''}`).join('\n') +
    `\n*TOTAL: ${soles(op.monto)}* · ${op.metodo}${op.operacion ? ' Op. ' + op.operacion : ''}\n` +
    (oficial ? '' : 'El número oficial se asignará al sincronizar.\n') + (cfg.MensajeRecibo || '');
  vista().innerHTML = `
    <section class="recibo ${rech ? 'rechazado' : ''}">
      <div class="cab"><b>${esc(cfg.Negocio || 'D@NDINET')}</b><span>${oficial ? 'RECIBO DE PAGO' : 'RECIBO PROVISIONAL'}</span>
        <strong>N° ${esc(nro)}</strong></div>
      ${rech ? `<p class="error">${res.aRevisar ? 'A REVISAR: ' : 'RECHAZADO: '}${esc(res.mensaje)}</p>` : ''}
      ${!oficial && !rech ? `<p class="aviso">${ic('reloj')}<span>${op.estadoLocal === 'pendiente' ? 'Pendiente de envío (sin señal o enviando…).' : 'Enviado, esperando respuesta.'} El número oficial llegará al sincronizar.</span></p>` : ''}
      <dl><dt>Fecha</dt><dd>${esc(txtFecha(op.fechaPago))}</dd><dt>Cliente</dt><dd>${esc(v.cliente)}</dd>
        <dt>DNI/RUC</dt><dd>${esc(v.doc)}</dd><dt>Atendió</dt><dd>${esc(v.usuario)}</dd></dl>
      <table><thead><tr><th>Periodo</th><th>Detalle</th><th>Pagado</th></tr></thead><tbody>
        ${lineas.map((d) => `<tr><td>${esc(d.periodo)}</td><td>${esc(d.detalle)}${d.parcial ? ' <small>(parcial)</small>' : ''}</td><td>${soles(d.monto)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totalr">TOTAL <b>${soles(op.monto)}</b></div>
      <p class="sub">${esc(op.metodo)}${op.operacion ? ' · Op. ' + esc(op.operacion) : ''}</p>
      ${res.mensaje && oficial ? `<p class="sub">${esc(res.mensaje)}</p>` : ''}
      <p class="pie">Recibo interno de control de pagos. No es comprobante SUNAT.</p>
      ${oficial ? `<div id="zonaPdf"><button class="btn grande azul" id="btnPdf">${ic('documento')}Recibo PDF</button></div>` : ''}
      ${!rech ? `<button class="btn ${oficial ? '' : 'grande verde'}" id="btnWspTxt">${ic('chat')}Enviar texto por WhatsApp</button>` : ''}
      <a class="btn" href="#/cliente/${esc(op.idCliente)}">Volver al cliente</a>
      <a class="btn secundario" href="#/inicio">Inicio</a>
    </section>`;
  if (oficial) $('#btnPdf').onclick = () => prepararPdf(res.nroRecibo, $('#zonaPdf'));
  if (!rech) $('#btnWspTxt').onclick = () => enviarWhatsApp(op.idCliente, texto);
}

/** Periodos guardados como fecha técnica (pagos migrados del Excel) → "JUL-2026". */
const txtPeriodos = (t) => String(t || '').replace(/(\d{4}-\d{2})-\d{2}T[\d:.]+Z?/g, (m, ym) => txtPeriodo(ym));

// ---- RECIBO DE UN PAGO DEL SERVIDOR (registrado en otro equipo o antes de borrar datos) ---
// Usa los pagos que ya llegan en la sincronización: no descarga nada extra ni ocupa más espacio.
function vPago(nro) {
  const p = D.pagos.find((x) => x.N_RECIBO === nro);
  if (!p) { vista().innerHTML = '<p class="error">Recibo no encontrado en los datos del celular (solo se guardan los últimos 13 meses).</p>'; return; }
  const cfg = D.config, anulado = p.ESTADO === 'Anulado';
  const periodos = mesesPago(p.PERIODOS);
  vista().innerHTML = `
    <section class="recibo ${anulado ? 'rechazado' : ''}">
      <div class="cab"><b>${esc(cfg.Negocio || 'D@NDINET')}</b><span>RECIBO DE PAGO</span><strong>N° ${esc(p.N_RECIBO)}</strong></div>
      ${anulado ? '<p class="aviso error">Este recibo está ANULADO.</p>' : ''}
      <dl><dt>Pagado el</dt><dd><b>${esc(txtFecha(p.FECHA))}</b></dd><dt>Cliente</dt><dd>${esc(p.CLIENTE)}</dd>
        <dt>Código</dt><dd>${esc(p.ID_CLIENTE)}</dd><dt>Atendió</dt><dd>${esc(p.USUARIO)}</dd></dl>
      <table class="periodos"><thead><tr><th>Meses pagados</th></tr></thead><tbody>
        ${periodos.map((x) => `<tr><td>${esc(x)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</tbody></table>
      <div class="totalr">TOTAL <b>${soles(p.MONTO)}</b></div>
      <p class="metodo-pago">${icoMetodo(p.METODO)}<span>${esc(p.METODO)}${p.OPERACION ? ' · Op. ' + esc(p.OPERACION) : ''}${Number(p.SALDO_RESTANTE) > 0 ? `<br><b class="error">Le queda por pagar ${soles(p.SALDO_RESTANTE)}</b>` : ''}</span></p>
      ${comentarioPago(p.OBS) ? `<p class="aviso">${ic('chat')}<span><b>Comentario:</b> ${esc(comentarioPago(p.OBS))}<br><small>Solo se ve aquí; no sale en el PDF.</small></span></p>` : ''}
      <p class="pie">Recibo interno de control de pagos. No es comprobante SUNAT.</p>
      <div id="zonaPdf"><button class="btn grande azul" id="btnPdf">${ic('documento')}Recibo PDF ${ayuda('Recibo PDF', 'Lo que ve en esta pantalla es el recibo.\n"Recibo PDF" prepara el archivo para enviarlo por WhatsApp (Compartir) o guardarlo en el celular.\nLa primera vez necesita señal; después queda guardado.')}</button></div>
      ${anulado ? '' : `<button class="btn" id="btnWsp">${ic('chat')}Enviar texto por WhatsApp</button>
        <button class="btn rojo-suave" id="btnAnular">${ic('anular')}Anular recibo</button>`}
      <a class="btn" href="#/cliente/${esc(p.ID_CLIENTE)}">Ver cliente</a>
      <a class="btn secundario" href="#/hoy">Volver</a>
    </section>`;
  $('#btnPdf').onclick = () => prepararPdf(p.N_RECIBO, $('#zonaPdf'));
  // detalle por servicio ("SERVICIO DE INTERNET · 3 meses") si el estado de cuenta del cliente está guardado
  kvGet('cuenta_' + p.ID_CLIENTE).then((cu) => {
    const det = cu ? cu.det.filter((d) => d.N_RECIBO === p.N_RECIBO) : [];
    const tb = vista().querySelector('table.periodos tbody');
    if (!det.length || !tb) return;
    const items = det.flatMap((d) => { const k = cu.cargos.find((x) => x.ID_CARGO === d.ID_CARGO) || {};
      const l = { per: String(k.PERIODO || '').slice(0, 7), periodo: txtPeriodo(k.PERIODO), base: nombreCorto(k), monto: Number(d.MONTO_APLICADO), parcial: Number(d.MONTO_APLICADO) < Number(k.MONTO) - 0.004 };
      // instalación cobrada completa: un renglón por gasto (mano de obra, materiales…), igual que en el PDF
      const partes = k.CONCEPTO === 'INSTALACION' && !l.parcial ? detalleInstalacion(k.OBS, k.MONTO) : null;
      return partes ? partes.map((x) => Object.assign({}, l, { base: 'INSTALACIÓN · ' + x.concepto, monto: x.monto })) : [l]; });
    const rango = (t) => (/INTERNET/i.test(t) ? 0 : /CATV|CABLE/i.test(t) ? 1 : 2);
    items.sort((a, b) => a.per.localeCompare(b.per) || rango(a.base) - rango(b.base));
    vista().querySelector('table.periodos thead').innerHTML = '<tr><th>Mes</th><th>Concepto</th><th>Importe</th></tr>';
    tb.innerHTML = items.map((l) => `<tr><td>${esc(l.periodo)}</td><td>${esc(l.base)}${l.parcial ? ' <small>(parcial)</small>' : ''}</td><td>${soles(l.monto)}</td></tr>`).join('');
  }).catch(() => {});
  if (!anulado) $('#btnAnular').onclick = () => anularRecibo(p.N_RECIBO);
  if (!anulado) $('#btnWsp').onclick = () => enviarWhatsApp(p.ID_CLIENTE,
    `*${cfg.Negocio || 'D@NDINET'}* — RECIBO DE PAGO ${p.N_RECIBO}\nFecha: ${txtFecha(p.FECHA)}\nCliente: ${p.CLIENTE}\nPeriodos: ${periodos.join(', ')}\n` +
    `*TOTAL: ${soles(p.MONTO)}* · ${p.METODO}${p.OPERACION ? ' Op. ' + p.OPERACION : ''}\n${cfg.MensajeRecibo || ''}`);
}

// ---- VENTANA EMERGENTE (modal) ---------------------------------------------------------
function modal(html) {
  cerrarModal();
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo'; fondo.id = 'modal';
  fondo.innerHTML = `<div class="modal">${html}</div>`;
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrarModal(); });
  document.body.appendChild(fondo);
  return fondo;
}
function cerrarModal() { const m = $('#modal'); if (m) m.remove(); }

/** Reemplazo accesible de confirm(): devuelve true/false. */
function confirmar(mensaje, { titulo = 'Confirmar', si = 'Sí, continuar', no = 'Cancelar', peligro = false } = {}) {
  return new Promise((ok) => {
    const m = modal(`<h3 id="dlgT">${esc(titulo)}</h3><p class="mensaje">${esc(mensaje)}</p>
      <div class="acciones"><button class="btn" data-r="0">${esc(no)}</button><button class="btn ${peligro ? 'rojo' : 'verde'}" data-r="1">${esc(si)}</button></div>`);
    prepararDialogo(m, () => ok(false));
    m.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { cerrarModal(); ok(b.dataset.r === '1'); }; });
    m.querySelector('[data-r="1"]').focus();
  });
}

/** Reemplazo accesible de prompt(): devuelve el texto o null. */
function pedirTexto(mensaje, { titulo = 'Escriba', valor = '', si = 'Aceptar', peligro = false } = {}) {
  return new Promise((ok) => {
    const m = modal(`<h3 id="dlgT">${esc(titulo)}</h3><label>${esc(mensaje)}<input id="dlgIn" value="${esc(valor)}" autocomplete="off"></label>
      <div class="acciones"><button class="btn" data-r="0">Cancelar</button><button class="btn ${peligro ? 'rojo' : 'verde'}" data-r="1">${esc(si)}</button></div>`);
    prepararDialogo(m, () => ok(null));
    const inp = m.querySelector('#dlgIn');
    const fin = (v) => { cerrarModal(); ok(v); };
    m.querySelector('[data-r="0"]').onclick = () => fin(null);
    m.querySelector('[data-r="1"]').onclick = () => fin(inp.value);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(inp.value); });
    inp.focus();
  });
}

/** Rol de diálogo, Escape para cerrar y clic fuera = cancelar. */
function prepararDialogo(fondo, alCancelar) {
  const caja = fondo.querySelector('.modal');
  caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-modal', 'true'); caja.setAttribute('aria-labelledby', 'dlgT');
  const cancelar = () => { cerrarModal(); alCancelar(); };
  fondo.addEventListener('click', (e) => { if (e.target === fondo) alCancelar(); });
  fondo.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelar(); });
}

// ---- WHATSAPP: elegir número si el cliente tiene dos ------------------------------------
function elegirTelefono(idCliente) {
  const c = D.porId[idCliente] || {};
  const nums = [...new Set([c.TELEFONO, c.TELEFONO2].map((t) => String(t || '').replace(/\D/g, '')).filter((t) => /^9\d{8}$/.test(t)))];
  if (!nums.length) { aviso('El cliente no tiene un celular válido registrado.', 'error'); return Promise.resolve(null); }
  if (nums.length === 1) return Promise.resolve(nums[0]);
  return new Promise((ok) => {
    const m = modal(`<h3>¿A qué número enviar?</h3><p class="sub">${esc(c.NOMBRES)}</p>
      ${nums.map((n, i) => `<button class="btn grande ${i ? '' : 'verde'}" data-n="${n}">${ic('celular')}${n}${i ? ' (celular 2)' : ' (principal)'}</button>`).join('')}
      <button class="btn secundario" data-n="">Cancelar</button>`);
    m.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => { cerrarModal(); ok(b.dataset.n || null); }; });
  });
}

async function enviarWhatsApp(idCliente, mensaje) {
  const tel = await elegirTelefono(idCliente);
  if (!tel) return;
  const url = enlaceWhatsApp(tel, mensaje);
  if (url) window.open(url, '_blank', 'noopener');
}

// ---- RECIBO PDF con caché en el celular ---------------------------------------------------
async function prepararPdf(nro, zona) {
  const pago = D.pagos.find((x) => x.N_RECIBO === nro);
  const estado = pago ? pago.ESTADO : 'Válido';
  let r = await kvGet('pdf4_' + nro);
  if (!r || r.estado !== estado) {          // no está guardado o cambió (por ejemplo, se anuló)
    if (!navigator.onLine) return aviso('Se necesita señal para generar el PDF la primera vez.', 'error');
    zona.innerHTML = '<p class="aviso">Generando el PDF de ' + esc(nro) + '… (solo la primera vez)</p>';
    try {
      r = await llamar('comprobante', { nro });
      r.estado = estado;
      await kvSet('pdf4_' + nro, r);
    } catch (e) {
      zona.innerHTML = `<p class="aviso error">${esc(e.message)}</p><button class="btn" id="btnPdfR">Reintentar</button>`;
      $('#btnPdfR').onclick = () => prepararPdf(nro, zona);
      return;
    }
  }
  const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const archivo = new File([bytes], r.nombre, { type: 'application/pdf' });
  const url = URL.createObjectURL(archivo);
  const puedeCompartir = navigator.canShare && navigator.canShare({ files: [archivo] });
  // sin "Ver PDF" en otra ventana: en el celular dejaba la app sin regreso. El recibo ya se ve en esta pantalla.
  zona.innerHTML = `<p class="sub etq-ic">${ic('documento')}${esc(r.nombre)}</p>` +
    (puedeCompartir ? `<button class="btn grande verde" id="btnShare">${ic('compartir')}Compartir PDF (WhatsApp…)</button>` : '') +
    `<button class="btn" id="btnGuardarPdf">${ic('descargar')}Guardar en el celular</button>`;
  $('#btnGuardarPdf').onclick = () => {
    const a = document.createElement('a');
    a.href = url; a.download = r.nombre; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    aviso('PDF guardado en Descargas del celular.');
  };
  if (puedeCompartir) $('#btnShare').onclick = () => navigator.share({ files: [archivo], title: 'Recibo ' + nro }).catch(() => {});
}

/** Anulación inmediata (no necesita el PDF). */
async function anularRecibo(nro) {
  const p = D.pagos.find((x) => x.N_RECIBO === nro);
  if (!p || p.ESTADO === 'Anulado') return aviso('El recibo ya está anulado.', 'error');
  const motivo = ((await pedirTexto('Motivo (el recibo NO se borra; los meses vuelven a quedar pendientes):',
    { titulo: `Anular ${nro} · ${soles(p.MONTO)}`, si: 'Anular recibo', peligro: true })) || '').trim();
  if (motivo.length < 4) return aviso('Anulación cancelada (el motivo debe tener al menos 4 letras).', 'error');
  await encolar({ tipo: 'ANULAR_PAGO', nroRecibo: nro, idCliente: p.ID_CLIENTE, motivo });
  aviso(navigator.onLine ? 'Anulación enviada.' : 'Anulación guardada: se enviará al volver la señal.');
}

// ---- MAPA para ubicar al cliente (OpenStreetMap + Leaflet, se carga solo cuando se usa) ---
let _leaflet = null;
function cargarLeaflet() {
  if (_leaflet) return _leaflet;
  _leaflet = new Promise((ok, mal) => {
    const css = document.createElement('link');
    // integrity: huella oficial de Leaflet 1.9.4; si el archivo del CDN cambiara, el navegador no lo ejecuta
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='; css.crossOrigin = '';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='; js.crossOrigin = '';
    js.onload = () => ok(window.L);
    js.onerror = () => { _leaflet = null; mal(new Error('No se pudo cargar el mapa (¿sin señal?)')); };
    document.head.appendChild(js);
  });
  return _leaflet;
}

/** Abre el mapa; devuelve "lat,lng" elegido o null. */
async function elegirEnMapa(actual) {
  if (!navigator.onLine) { aviso('El mapa necesita señal. Use "Aquí" o escriba las coordenadas.', 'error'); return null; }
  let L;
  try { L = await cargarLeaflet(); } catch (e) { aviso(e.message, 'error'); return null; }
  const m0 = String(actual || '').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
  let punto = m0 ? [Number(m0[1]), Number(m0[2])] : [-11.4325, -74.4825];   // por defecto: Pangoa
  return new Promise((ok) => {
    const fondo = modal(`<h3>Ubicar al cliente</h3><p class="sub">Toque el mapa para poner la marca. Puede acercar con dos dedos.</p>
      <div id="mapaCapas"></div><div id="mapa" class="mapa"></div><p class="sub" id="mapaTxt"></p>
      <div class="botones"><button class="btn" id="mapaYo">${ic('ubicacion')}Mi ubicación</button><button class="btn verde" id="mapaOk">${ic('check')}Usar esta</button></div>
      <button class="btn secundario" id="mapaNo">Cancelar</button>`);
    fondo.querySelector('.modal').classList.add('grande');
    const mapa = L.map('mapa').setView(punto, m0 ? 17 : 14);
    ponerCapas(L, mapa, $('#mapaCapas'));
    const marca = L.marker(punto, { draggable: true }).addTo(mapa);
    const mostrar = () => { $('#mapaTxt').textContent = punto[0].toFixed(5) + ', ' + punto[1].toFixed(5); };
    mostrar();
    mapa.on('click', (e) => { punto = [e.latlng.lat, e.latlng.lng]; marca.setLatLng(e.latlng); mostrar(); });
    marca.on('dragend', () => { const p = marca.getLatLng(); punto = [p.lat, p.lng]; mostrar(); });
    $('#mapaYo').onclick = () => navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => {
      punto = [p.coords.latitude, p.coords.longitude]; marca.setLatLng(punto); mapa.setView(punto, 17); mostrar();
    }, () => aviso('No se pudo obtener la ubicación.', 'error'), { enableHighAccuracy: true, timeout: 15000 });
    $('#mapaOk').onclick = () => { cerrarModal(); ok(punto[0].toFixed(5) + ',' + punto[1].toFixed(5)); };
    $('#mapaNo').onclick = () => { cerrarModal(); ok(null); };
    setTimeout(() => mapa.invalidateSize(), 200);
  });
}

// ---- CAPAS DEL MAPA: calles, satélite y terreno (en zonas rurales el relieve y la foto guían mejor) ----
const CAPAS_MAPA = {
  calles: ['Calles', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }],
  satelite: ['Satélite', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imágenes © Esri' }],
  terreno: ['Terreno', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap' }],
};
const AYUDA_CAPAS = 'Calles: mapa normal con nombres.\nSatélite: foto real desde arriba (casas, chacras, caminos).\nTerreno: muestra cerros, quebradas y ríos con curvas de nivel: útil para llegar en zonas rurales.\nLa capa que elija queda guardada en este celular.';
/** Botones grandes de capa (en vez del control pequeño de Leaflet) dentro de cont. */
async function ponerCapas(L, mapa, cont) {
  let actual = (await kvGet('capaMapa')) || 'calles';
  if (!CAPAS_MAPA[actual]) actual = 'calles';
  const capas = Object.fromEntries(Object.entries(CAPAS_MAPA).map(([k, [, url, op]]) => [k, L.tileLayer(url, op)]));
  const usar = (k) => {
    Object.values(capas).forEach((c) => mapa.removeLayer(c));
    capas[k].addTo(mapa);
    if (mapa.getZoom() > CAPAS_MAPA[k][2].maxZoom) mapa.setZoom(CAPAS_MAPA[k][2].maxZoom);
    actual = k;
    cont.querySelectorAll('[data-capa]').forEach((b) => { const si = b.dataset.capa === k; b.classList.toggle('sel', si); b.setAttribute('aria-pressed', si); });
  };
  cont.innerHTML = `<div class="capas-mapa" role="group" aria-label="Tipo de mapa">${Object.entries(CAPAS_MAPA).map(([k, [t]]) =>
    `<button type="button" class="mini" data-capa="${k}">${ic(k === 'calles' ? 'mapa' : k === 'satelite' ? 'camara' : 'grafico')}${t}</button>`).join('')}${ayuda('Tipo de mapa', AYUDA_CAPAS)}</div>`;
  cont.querySelectorAll('[data-capa]').forEach((b) => { b.onclick = () => { usar(b.dataset.capa); kvSet('capaMapa', b.dataset.capa); }; });
  usar(actual);
}
/** "lat,lng" → [lat, lng] o null. */
const leerGps = (t) => { const m = String(t || '').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/); if (!m) return null;
  const p = [Number(m[1]), Number(m[2])]; return Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && (p[0] || p[1]) ? p : null; };
const comoLlegar = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p[0]},${p[1]}`;

// ---- MAPA GENERAL: todos los clientes y las órdenes pendientes, por color según importancia ----
const MAPA_CAT = {
  orden: { t: 'Órdenes pendientes', color: 'azul', icono: 'lista', forma: 'cuadro' },
  cortar: { t: 'A cortar', color: 'rojo', icono: 'cortar' },
  moroso: { t: 'Morosos', color: 'ambar', icono: 'alerta' },
  activo: { t: 'Al día', color: 'verde', icono: 'check' },
  pausa: { t: 'Cortados / suspendidos', color: 'gris', icono: 'reloj' },
};
const AYUDA_MAPA = 'Cada punto es un cliente o una orden pendiente.\nCuadrado = orden pendiente (el ícono dice el tipo: tijera corte, router servicio, lista orden libre).\nRojo = a cortar · Ámbar = moroso · Verde = al día · Gris = cortado o suspendido.\nToque un punto para ver el detalle, abrir la ficha, llamar o ir con Google Maps ("Cómo llegar").\nUse los botones de colores para mostrar u ocultar cada grupo.\nSolo aparecen los clientes con ubicación guardada: agréguela en Editar cliente → Ubicación.';
function categoriaCliente(id) {
  const r = D.resumen[id] || {};
  if (r.ESTADO === 'Baja' || !r.ESTADO) return null;
  if (/CORTAR/.test(r.ALERTA || '')) return 'cortar';
  if (r.ESTADO === 'Moroso') return 'moroso';
  if (r.ESTADO === 'Cortado' || r.ESTADO === 'Suspendido') return 'pausa';
  return 'activo';
}
async function vMapaGeneral() {
  const ver = Object.assign({ orden: true, cortar: true, moroso: true, activo: true, pausa: false }, (await kvGet('mapaVer')) || {});
  let zona = (await kvGet('mapaZona')) || '';
  // puntos: clientes con ubicación + cada lugar de una orden pendiente
  const puntos = [];
  D.clientes.forEach((c) => { const p = leerGps(c.COORDENADAS), cat = p && categoriaCliente(c.ID_CLIENTE); if (cat) puntos.push({ cat, p, zona: c.ZONA || '', cli: c }); });
  (await ordenesLocales()).filter((o) => o.estado === 'Pendiente').forEach((o) => {
    if (o.tipo === 'ORDEN_LIBRE') { const p = leerGps(o.datos.gps); if (p) puntos.push({ cat: 'orden', p, zona: o.datos.zona || '', ot: o }); return; }
    const vistos = new Set();
    o.items.filter((it) => it.estado === 'Pendiente').forEach((it) => {
      const c = D.porId[it.idCliente] || {}, p = leerGps((it.snap || {}).gps || c.COORDENADAS);
      if (p && !vistos.has(it.idCliente)) { vistos.add(it.idCliente); puntos.push({ cat: 'orden', p, zona: (it.snap || {}).zona || c.ZONA || '', ot: o, cli: c, snap: it.snap || {} }); }
    });
  });
  const zonas = [...new Set(puntos.map((x) => x.zona).filter(Boolean))].sort();
  const sinUbic = D.clientes.filter((c) => categoriaCliente(c.ID_CLIENTE) && !leerGps(c.COORDENADAS)).length;
  vista().innerHTML = `<h2 class="tit-ic">${ic('mapa')}Mapa general ${ayuda('Mapa general', AYUDA_MAPA)}</h2>
    <div class="chips-mapa" id="mgF" role="group" aria-label="Qué mostrar"></div>
    <label class="fila-zona">Zona<select id="mgZona"><option value="">Todas las zonas</option>${zonas.map((z) => `<option ${z === zona ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
    <div id="mgCapas"></div>
    <div class="mapa-caja"><div id="mapaG" class="mapa mapa-general" aria-label="Mapa de clientes y órdenes"></div>
      <button type="button" class="btn-mapa" id="mgYo" aria-label="Mi ubicación">${ic('ubicacion')}</button></div>
    <p class="sub" id="mgTxt"></p>
    ${sinUbic ? `<p class="globo">${ic('info')}<span>${sinUbic} cliente(s) aún no tienen ubicación guardada y no aparecen en el mapa.</span></p>` : ''}`;
  const pintarChips = (cuenta) => {
    $('#mgF').innerHTML = Object.entries(MAPA_CAT).map(([k, c]) => `<button type="button" class="chip-mapa c-${c.color} ${ver[k] ? 'sel' : ''}" data-cat="${k}" aria-pressed="${ver[k]}">
      <span class="mk mk-${c.color} ${c.forma || ''}">${ic(c.icono)}</span>${esc(c.t)} <b>${cuenta[k] || 0}</b></button>`).join('');
    $('#mgF').querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { ver[b.dataset.cat] = !ver[b.dataset.cat]; kvSet('mapaVer', ver); pintar(); }; });
  };
  if (!navigator.onLine) {
    const cuenta = {}; puntos.forEach((x) => { cuenta[x.cat] = (cuenta[x.cat] || 0) + 1; });
    pintarChips(cuenta);
    $('#mapaG').outerHTML = `<p class="aviso">${ic('alerta')}<span>Sin señal el mapa no carga. Aquí tiene las órdenes pendientes y los clientes a cortar:</span></p>
      <ul class="lista">${puntos.filter((x) => x.cat === 'orden' || x.cat === 'cortar').slice(0, 60).map((x) => `<li><a href="${x.ot ? '#/orden/' + encodeURIComponent(x.ot.ref) : '#/cliente/' + esc(x.cli.ID_CLIENTE)}"><div><b>${esc(x.ot ? OT_NOMBRE[x.ot.tipo] || x.ot.tipo : x.cli.NOMBRES)}</b>
        <small>${esc(x.cli ? x.cli.NOMBRES : x.ot.detalle || '')} · ${esc(x.zona)}</small></div>${ic('flecha', 'fin')}</a></li>`).join('') || '<li class="vacio">Nada pendiente.</li>'}</ul>`;
    $('#mgYo').hidden = true;
    return;
  }
  let L;
  try { L = await cargarLeaflet(); } catch (e) { $('#mgTxt').textContent = e.message; return; }
  if (!$('#mapaG')) return;                              // el usuario ya salió de la pantalla
  const mapa = L.map('mapaG', { zoomControl: true }).setView([-11.4325, -74.4825], 13);
  await ponerCapas(L, mapa, $('#mgCapas'));
  const capa = L.layerGroup().addTo(mapa);
  let primera = true, yo = null;
  const icono = (cat) => { const c = MAPA_CAT[cat]; return L.divIcon({ className: 'mk-envoltura', html: `<span class="mk mk-${c.color} ${c.forma || ''}">${ic(c.icono)}</span>`, iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -14] }); };
  const iconoOt = (o) => { const [icn, col] = OT_VISUAL[o.tipo] || ['lista', 'azul']; return L.divIcon({ className: 'mk-envoltura', html: `<span class="mk mk-${col} cuadro">${ic(icn)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14] }); };
  const globo = (x) => {
    const tel = x.cli && (x.cli.TELEFONO || ''), r = x.cli ? D.resumen[x.cli.ID_CLIENTE] || {} : {};
    const cab = x.ot ? `<b>${esc(OT_NOMBRE[x.ot.tipo] || x.ot.tipo)}</b><small>${esc(x.ot.detalle || '')}</small>${x.cli ? `<small>${esc(x.cli.NOMBRES)}</small>` : ''}`
      : `<b>${esc(x.cli.NOMBRES)}</b><small>${esc(x.cli.ID_CLIENTE)} · ${esc(x.cat === 'cortar' ? 'A CORTAR' : r.ESTADO || '')}${Number(r.MESES_ADEUDA) > 0 ? ' · ' + esc(r.MESES_ADEUDA) + ' mes(es)' : ''}${Number(r.DEUDA_VENCIDA) > 0 ? ' · debe ' + soles(r.DEUDA_VENCIDA) : ''}</small>`;
    return `<div class="globo-mapa">${cab}${x.zona ? `<small>${ic('ubicacion')}${esc(x.zona)}</small>` : ''}<div class="globo-acc">
      ${x.ot ? `<a class="mini" href="#/orden/${encodeURIComponent(x.ot.ref)}">${ic('lista')}Ver orden</a>` : ''}
      ${x.cli && x.cli.ID_CLIENTE ? `<a class="mini" href="#/cliente/${esc(x.cli.ID_CLIENTE)}">${ic('usuario')}Ficha</a>` : ''}
      ${tel ? `<a class="mini" href="tel:${esc(String(tel).replace(/\s+/g, ''))}">${ic('telefono')}Llamar</a>` : ''}
      <a class="mini verde" href="${comoLlegar(x.p)}" target="_blank" rel="noopener">${ic('flecha')}Cómo llegar</a></div></div>`;
  };
  function pintar() {
    capa.clearLayers();
    const cuenta = {}, visibles = [];
    puntos.forEach((x) => {
      if (zona && x.zona !== zona) return;
      cuenta[x.cat] = (cuenta[x.cat] || 0) + 1;
      if (!ver[x.cat]) return;
      visibles.push(x.p);
      L.marker(x.p, { icon: x.ot ? iconoOt(x.ot) : icono(x.cat), zIndexOffset: x.ot ? 1000 : x.cat === 'cortar' ? 500 : 0,
        keyboard: true, title: x.ot ? (OT_NOMBRE[x.ot.tipo] || '') : x.cli.NOMBRES }).bindPopup(globo(x), { maxWidth: 260 }).addTo(capa);
    });
    pintarChips(cuenta);
    $('#mgTxt').textContent = `${visibles.length} punto(s) en el mapa${zona ? ' · zona ' + zona : ''}.`;
    if (primera && visibles.length) { mapa.fitBounds(L.latLngBounds(visibles), { padding: [30, 30], maxZoom: 16 }); primera = false; }
  }
  $('#mgZona').onchange = () => { zona = $('#mgZona').value; kvSet('mapaZona', zona); primera = true; pintar(); };
  $('#mgYo').onclick = () => navigator.geolocation && navigator.geolocation.getCurrentPosition((g) => {
    const p = [g.coords.latitude, g.coords.longitude];
    if (yo) yo.setLatLng(p); else yo = L.marker(p, { icon: L.divIcon({ className: 'mk-envoltura', html: '<span class="mk-yo"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000 }).bindPopup('Usted está aquí').addTo(mapa);
    mapa.setView(p, Math.max(mapa.getZoom(), 15));
  }, () => aviso('No se pudo obtener su ubicación (¿GPS apagado?).', 'error'), { enableHighAccuracy: true, timeout: 15000 });
  pintar();
  setTimeout(() => mapa.invalidateSize(), 200);
}

// ---- CONFIGURACIÓN: planes, modos, zonas y métodos (solo admin) ---------------------------
function vConfig() {
  const servActivos = (plan) => D.servicios.filter((s) => s.PLAN === plan && s.ESTADO === 'Activo').length;
  const tipos = [['ZONA', 'Zonas'], ['MODO', 'Modos / equipos'], ['METODO', 'Métodos de pago']];
  vista().innerHTML = `<h2>Configuración</h2>
    <p class="sub">Los cambios se aplican al sincronizar. Nada se borra: lo que no se usa se desactiva.</p>
    <h3>Planes y precios</h3>
    <button class="btn verde" id="nuevoPlan">${ic('agregar')}Nuevo plan</button>
    <ul class="lista">${D.planes.map((p) => `<li><a href="#" data-plan="${esc(p.PLAN)}"><div><b>${esc(p.PLAN)}</b>
      <small>${esc(p.CODIGO || '')} · ${servActivos(p.PLAN)} servicio(s) activo(s)</small></div>
      <div class="der"><b>${soles(p.TARIFA)}</b>${p.ACTIVO === 'No' ? '<small class="error">inactivo</small>' : ''}</div></a></li>`).join('')}</ul>
    ${tipos.map(([t, tit]) => `<h3>${tit}</h3>
      <div class="chips">${D.listas.filter((x) => x.TIPO === t && x.VALOR !== 'MIGRADO').map((x) =>
        `<button class="mini ${x.ACTIVO === 'No' ? 'apagado' : 'sel'}" data-tipo="${t}" data-valor="${esc(x.VALOR)}" data-activo="${x.ACTIVO === 'No' ? 'No' : 'Sí'}">${esc(x.VALOR)}</button>`).join('')}
        <button class="mini" data-agregar="${t}">${ic('agregar')}Agregar</button></div>`).join('')}
    <p class="sub">Toque un valor para activarlo o desactivarlo.</p>`;
  const editarPlan = (p) => {
    const nuevo = !p, n = p ? servActivos(p.PLAN) : 0;
    const proximo = hoyISO().slice(0, 7) < '9999' ? (() => { const d = new Date(hoyISO() + 'T12:00:00'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); })() : '';
    const fondo = modal(`<h3>${nuevo ? 'Nuevo plan' : 'Editar plan'}</h3>
      <label>Nombre del plan<input id="pNom" value="${esc(p ? p.PLAN : '')}" ${nuevo ? '' : 'disabled'}></label>
      <label>Código<input id="pCod" value="${esc(p ? p.CODIGO || '' : '')}"></label>
      <label>Tarifa mensual (S/)<input id="pTar" type="number" step="0.10" inputmode="decimal" value="${p ? Number(p.TARIFA) : ''}"></label>
      <label class="check"><input type="checkbox" id="pAct" ${!p || p.ACTIVO !== 'No' ? 'checked' : ''}> Plan activo (aparece al registrar clientes)</label>
      ${n ? `<div class="aviso"><label class="check"><input type="checkbox" id="pApl"> Aplicar la nueva tarifa a los <b>${n}</b> servicio(s) activo(s) de este plan</label>
        <label>Desde el mes<input id="pDesde" type="month" value="${proximo}"></label>
        <small>Solo cambian las cuotas SIN pagos desde ese mes. Si no lo marca, los clientes actuales conservan su precio.</small></div>` : ''}
      <button class="btn grande verde" id="pOk">GUARDAR</button><button class="btn secundario" id="pNo">Cancelar</button>`);
    $('#pNo').onclick = cerrarModal;
    $('#pOk').onclick = async () => {
      const nombre = $('#pNom').value.trim(), tarifa = Number($('#pTar').value || 0);
      if (nombre.length < 3) return aviso('Escriba el nombre del plan.', 'error');
      if (nuevo && D.planes.some((x) => x.PLAN.toUpperCase() === nombre.toUpperCase())) return aviso('Ya existe un plan con ese nombre.', 'error');
      if (!(tarifa > 0)) return aviso('La tarifa debe ser mayor a 0.', 'error');
      const aplicar = !!(fondo.querySelector('#pApl') && $('#pApl').checked);
      const desde = aplicar ? $('#pDesde').value : '';
      if (aplicar && !desde) return aviso('Elija desde qué mes rige la nueva tarifa.', 'error');
      if (aplicar && !(await confirmar(`Se cambiará a ${soles(tarifa)} la mensualidad de ${n} servicio(s) desde ${desde}.`, { titulo: 'Aplicar nueva tarifa' }))) return;
      await encolar({ tipo: 'GUARDAR_PLAN', plan: nombre, tarifa, fecha: desde ? desde + '-01' : '',
        datos: { codigo: $('#pCod').value.trim(), activo: $('#pAct').checked ? 'Sí' : 'No', aplicarServicios: aplicar } });
      cerrarModal();
      aviso(navigator.onLine ? 'Plan enviado.' : 'Guardado: se enviará al volver la señal.');
    };
  };
  $('#nuevoPlan').onclick = () => editarPlan(null);
  vista().querySelectorAll('[data-plan]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); editarPlan(D.planes.find((p) => p.PLAN === a.dataset.plan)); }; });
  vista().querySelectorAll('[data-valor]').forEach((b) => { b.onclick = async () => {
    const activar = b.dataset.activo === 'No';
    if (!(await confirmar(`"${b.dataset.valor}"`, { titulo: activar ? '¿Activar?' : '¿Desactivar?', si: activar ? 'Activar' : 'Desactivar' }))) return;
    await encolar({ tipo: 'GUARDAR_LISTA', datos: { tipo: b.dataset.tipo, valor: b.dataset.valor, activo: activar ? 'Sí' : 'No' } });
    b.dataset.activo = activar ? 'Sí' : 'No'; b.classList.toggle('apagado', !activar); b.classList.toggle('sel', activar);
    aviso('Enviado.');
  }; });
  vista().querySelectorAll('[data-agregar]').forEach((b) => { b.onclick = async () => {
    const valor = ((await pedirTexto('Nuevo valor:', { titulo: 'Agregar', si: 'Agregar' })) || '').trim();
    if (valor.length < 2) return;
    await encolar({ tipo: 'GUARDAR_LISTA', datos: { tipo: b.dataset.agregar, valor, activo: 'Sí' } });
    aviso(navigator.onLine ? 'Agregado: aparecerá al sincronizar.' : 'Guardado: se enviará al volver la señal.');
  }; });
}

/** Reduce la foto (máx. 1280 px, JPEG 70 %) para que pese ~150 KB y viaje rápido. */
function comprimirImagen(archivo) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(archivo);
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      ok(cv.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = mal;
    img.src = url;
  });
}

// ---- COLA DE ENVÍO -------------------------------------------------------------------
async function vCola() {
  const cola = (await colaTodos()).sort((a, b) => String(b.fDispositivo).localeCompare(String(a.fDispositivo))).slice(0, 150);
  const etiqueta = { pendiente: ic('reloj') + 'Pendiente', enviado: ic('enviado') + 'Enviado', ok: ic('listo') + 'Listo', rechazado: ic('alerta') + 'Rechazado', error: ic('alerta') + 'Error' };
  vista().innerHTML = `<h2>Cola de envío</h2>
    <button class="btn" id="btnSync">${ic('enviado')}Enviar ahora</button>
    <ul class="lista">${cola.map((o) => {
      const res = o.resultado || {}, cli = D.porId[o.idCliente] || {};
      const nombres = { EDITAR_SERVICIO: 'Corregir servicio', GUARDAR_CONFIG: 'Datos del negocio', EDITAR_PPPOE: 'Editar PPPoE', CREAR_ORDEN: 'Orden / hoja de ruta', CERRAR_ITEM_ORDEN: 'Marcar en orden', ANULAR_ORDEN: 'Anular orden', PAUSA_VACACIONES: 'Pausa vacacional', TERMINAR_PAUSA: 'Fin de pausa', CAMBIAR_PLAN: 'Cambio de plan', NUEVO_SERVICIO: 'Nuevo servicio', AJUSTAR_CARGOS: 'Ajuste de cuenta', CREAR_CONVENIO: 'Convenio / castigo', REVERTIR_CONVENIO: 'Revertir convenio', RENOVAR_ANIO: 'Renovar contrato', ALTA_CLIENTE: 'Nuevo cliente', EDITAR_CLIENTE: 'Editar cliente', ANULAR_PAGO: 'Anular recibo', CORTAR: 'Corte',
        SUSPENDER: 'Suspensión', BAJA: 'Baja', REACTIVAR: 'Reactivación', ASIGNAR_PPPOE: 'Asignar PPPoE', LIBERAR_PPPOE: 'Liberar PPPoE',
        BLOQUEAR_PPPOE: 'Bloquear PPPoE', DESBLOQUEAR_PPPOE: 'Desbloquear PPPoE', AGREGAR_PPPOE: 'Agregar PPPoE' };
      const detalle = o.tipo === 'ALTA_CLIENTE' ? ((o.datos || {}).cliente || {}).NOMBRES : o.tipo === 'ANULAR_PAGO' ? o.nroRecibo
        : /PPPOE/.test(o.tipo) ? o.codigoPPPoE : (cli.NOMBRES || o.idServ || '');
      const titulo = o.tipo === 'COBRO' ? `Cobro ${soles(o.monto)} · ${cli.NOMBRES || o.idCliente}` : `${nombres[o.tipo] || o.tipo} · ${detalle || ''}`;
      return `<li><a href="${o.tipo === 'COBRO' ? '#/recibo/' + esc(o.idSolicitud) : '#/cola'}">
        <div><b>${esc(titulo)}</b><small>${esc(txtFecha(o.fDispositivo))} ${esc(String(o.fDispositivo).slice(11, 16))} · ${esc(res.nroRecibo || o.reciboProvisional || '')}</small>
        ${res.mensaje && o.estadoLocal !== 'ok' ? `<small class="${o.estadoLocal === 'rechazado' ? 'error' : ''}">${esc(res.mensaje)}</small>` : ''}</div>
        <div class="der"><span class="chip ${o.estadoLocal === 'ok' ? 'e-activo' : o.estadoLocal === 'rechazado' || o.estadoLocal === 'error' ? 'e-moroso' : 'e-porvencer'}">${etiqueta[o.estadoLocal] || o.estadoLocal}</span></div>
      </a></li>`;
    }).join('') || '<li class="vacio">No hay operaciones.</li>'}</ul>`;
  $('#btnSync').onclick = sincronizarManual;
}

// ---- MIS COBROS DE HOY -------------------------------------------------------------
async function cobrosDeHoy() {
  const hoy = hoyISO();
  const mios = (await colaTodos()).filter((o) => o.tipo === 'COBRO' && String(o.fechaPago) === hoy && o.estadoLocal !== 'rechazado');
  const nrosCola = new Set(mios.map((o) => (o.resultado || {}).nroRecibo).filter(Boolean));
  const delServidor = D.pagos.filter((p) => String(p.FECHA).slice(0, 10) === hoy && String(p.USUARIO).toLowerCase() === PERFIL.email &&
    p.ESTADO !== 'Anulado' && !nrosCola.has(p.N_RECIBO));
  const items = mios.map((o) => ({ nro: (o.resultado || {}).nroRecibo || o.reciboProvisional, cliente: (o.vista || {}).cliente, monto: o.monto, metodo: o.metodo, estado: o.estadoLocal, id: o.idSolicitud }))
    .concat(delServidor.map((p) => ({ nro: p.N_RECIBO, cliente: p.CLIENTE, monto: Number(p.MONTO), metodo: p.METODO, estado: 'ok' })));
  return { items, total: r2(items.reduce((s, x) => s + Number(x.monto), 0)) };
}

async function vHoy() {
  const { items, total } = await cobrosDeHoy();
  const porMetodo = {};
  items.forEach((x) => { porMetodo[x.metodo] = r2((porMetodo[x.metodo] || 0) + Number(x.monto)); });
  vista().innerHTML = `<p class="eyebrow">${esc(txtFecha(hoyISO()))}</p><h2>Mis cobros de hoy</h2>
    <section class="hero"><span class="eyebrow">Total cobrado</span><span class="monto">${soles(total)}</span><span class="de">${items.length} recibo(s)</span></section>
    <table class="resumen"><tbody>${Object.entries(porMetodo).map(([m, v]) => `<tr><td>${esc(m)}</td><td>${soles(v)}</td></tr>`).join('')}</tbody></table>
    <ul class="lista">${items.map((x) => `<li><a href="${x.id ? '#/recibo/' + esc(x.id) : '#/pago/' + encodeURIComponent(x.nro)}"><div><b>${esc(x.nro)}</b><small>${esc(x.cliente)} · ${esc(x.metodo)}</small></div>
      <div class="der">${soles(x.monto)}${x.estado !== 'ok' ? `<span class="chip e-porvencer">${ic('reloj')}Sin enviar</span>` : ''}</div></a></li>`).join('') || '<li class="vacio">Aún no hay cobros hoy.</li>'}</ul>`;
}

// ---- A CORTAR (con filtros: zona, cuotas vencidas y orden) --------------------------
async function vACortar() {
  const todos = Object.values(D.resumen).filter((r) => /CORTAR/.test(r.ALERTA || ''));
  const zonas = [...new Set(todos.map((r) => r.ZONA).filter(Boolean))].sort();
  const f = Object.assign({ zona: '', meses: 0, orden: 'deuda-desc' }, (await kvGet('filtrosCortar')) || {});
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  vista().innerHTML = `<h2>Clientes a cortar</h2>
    <p class="sub">Regla: ${esc(D.config.DiasCorte || 30)} días o más de atraso.</p>
    <div class="filtros tres">
      <label>Zona<select id="fZona">${opt('', 'Todas', f.zona)}${zonas.map((z) => opt(z, z, f.zona)).join('')}</select></label>
      <label>Cuotas vencidas<select id="fMeses">${[[0, 'Todas'], [1, '1 o más'], [2, '2 o más'], [3, '3 o más'], [6, '6 o más'], [12, '12 o más']].map(([v, t]) => opt(v, t, f.meses)).join('')}</select></label>
      <label>Orden<select id="fOrden">${opt('deuda-desc', 'Deuda: mayor a menor', f.orden)}${opt('deuda-asc', 'Deuda: menor a mayor', f.orden)}${opt('dias-desc', 'Atraso: mayor a menor', f.orden)}${opt('dias-asc', 'Atraso: menor a mayor', f.orden)}</select></label>
    </div>
    <p class="sub" id="cTotal"></p>
    <button class="btn azul" id="btnRuta">${ic('mapa')}Generar hoja de ruta</button>
    <ul class="lista" id="cLista"></ul>`;
  let actual = [];
  $('#btnRuta').onclick = async () => {
    const items = actual.flatMap((r) => D.servicios.filter((x) => x.ID_CLIENTE === r.ID_CLIENTE && x.ESTADO === 'Activo')
      .map((x) => ({ idServ: x.ID_SERV, idCliente: r.ID_CLIENTE, snap: snapshotLocal(r.ID_CLIENTE, x.ID_SERV) })));
    if (!items.length) return aviso('No hay servicios activos para cortar con estos filtros.', 'error');
    if (items.length > 150) return aviso(`Son ${items.length} servicios: máximo 150 por hoja. Filtre por zona.`, 'error');
    if (!(await confirmar(`${items.length} servicio(s) de ${actual.length} cliente(s)${f.zona ? ' · ' + f.zona : ''}.\nQueda PENDIENTE hasta marcar a cada cliente como cortado o no cortado.`,
      { titulo: '¿Generar hoja de ruta de cortes?', si: 'Generar' }))) return;
    const op = { tipo: 'CREAR_ORDEN', datos: { tipo: 'RUTA_CORTE', items: items.map((x) => ({ idServ: x.idServ, idCliente: x.idCliente })) },
      vista: { tipo: 'RUTA_CORTE', datos: { zona: f.zona }, items } };
    await encolar(op);
    aviso(navigator.onLine ? 'Hoja de ruta enviada.' : 'Hoja guardada sin señal: ya puede imprimirla.');
    location.hash = '#/orden/' + op.idSolicitud;
  };
  const pintar = async () => {
    f.zona = $('#fZona').value; f.meses = Number($('#fMeses').value); f.orden = $('#fOrden').value;
    await kvSet('filtrosCortar', f);
    const [campo, dir] = f.orden.split('-');
    const valor = (r) => Number(campo === 'deuda' ? r.DEUDA_VENCIDA : r.DIAS_ATRASO) || 0;
    const lista = todos.filter((r) => (!f.zona || r.ZONA === f.zona) && (Number(r.MESES_ADEUDA) || 0) >= f.meses)
      .sort((x, y) => (dir === 'asc' ? 1 : -1) * (valor(x) - valor(y)));
    actual = lista;
    const suma = lista.reduce((t, r) => t + Number(r.DEUDA_VENCIDA || 0), 0);
    $('#cTotal').textContent = `${lista.length} cliente(s) · deuda vencida ${soles(suma)}`;
    $('#cLista').innerHTML = lista.map((r) => `<li><a href="#/cliente/${esc(r.ID_CLIENTE)}"><div><b>${esc(r.NOMBRES)}</b>
      <small>${esc(r.ID_CLIENTE)} · ${esc(r.ZONA)}${r.PPPOE ? ' · PPPoE ' + esc(r.PPPOE) : ''}</small>
      <small>${Number(r.MESES_ADEUDA) || 0} cuota(s) vencida(s) · ${esc(txtMora(r.DIAS_ATRASO))} de atraso</small></div>
      <div class="der"><b class="error">${soles(r.DEUDA_VENCIDA)}</b></div></a></li>`).join('') || '<li class="vacio">Nadie para cortar con estos filtros.</li>';
  };
  ['#fZona', '#fMeses', '#fOrden'].forEach((x) => { $(x).onchange = pintar; });
  pintar();
}

// ---- CORTE / REACTIVACIÓN ------------------------------------------------------------
function servicioPorId(idServ) { return D.servicios.find((s) => s.ID_SERV === idServ); }

const ACC_CORTE = [
  { v: 'CORTAR', t: 'Corte', sub: 'Por falta de pago', icono: 'cortar', clase: 'rojo',
    ayuda: 'Se corta el servicio por deuda.\n• El PPPoE queda libre para otro cliente.\n• La deuda se mantiene.\n• Las cuotas de los meses siguientes se anulan.\nPara volver: Reactivar (el primer mes se cobra por días).' },
  { v: 'SUSPENDER', t: 'Suspensión', sub: 'Temporal', icono: 'reloj', clase: 'ambar',
    ayuda: 'Pausa temporal pedida por el cliente o por la empresa.\n• El PPPoE queda reservado (no se entrega a otro).\n• La deuda se mantiene.\nPara vacaciones con descuento use mejor "Pausa vacacional".' },
  { v: 'BAJA', t: 'Baja', sub: 'Fin del servicio', icono: 'cerrar', clase: 'gris',
    ayuda: 'El cliente deja el servicio (o quita uno de su paquete).\n• Se anulan las cuotas futuras y se libera el PPPoE.\n• La deuda se mantiene y el historial queda.\nSi vuelve, se puede "Volver a activar" desde la ficha.' },
];

function vCorte(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  // paquete DUO (INTERNET + CATV): se ofrece actuar sobre los dos; "Baja" de uno solo = quitarlo del paquete
  const duo = serviciosDuo(s.ID_CLIENTE);
  const paquete = duo && duo.todos.some((x) => x.ID_SERV === s.ID_SERV) ? duo.todos : null;
  vista().innerHTML = `<section class="form"><h2>Corte / suspensión / baja</h2>
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.PLAN)} · PPPoE ${esc(s.PPPOE || '-')}</p>
    <h3>¿Qué hacer?</h3>
    <div class="tipos-aj acciones-corte" role="radiogroup" aria-label="Acción">${ACC_CORTE.map((a, i) => `<label class="${a.clase}">
      <input type="radio" name="acc" value="${a.v}" ${i ? '' : 'checked'}>${ic(a.icono)}${esc(a.t)}<small>${esc(a.sub)}</small>${ayuda(a.t, a.ayuda)}</label>`).join('')}</div>
    ${paquete ? `<fieldset class="paquete"><legend>Paquete DUO: ¿a qué servicios?</legend>
      <div class="tipos-aj srv-duo">${paquete.map((x) => `<label><input type="checkbox" class="srvDuo" value="${esc(x.ID_SERV)}" data-estado="${esc(x.ESTADO)}">
        ${ic(esCatv(x) ? 'tv' : 'wifi')}${esc(nombreCorto({ CONCEPTO: 'MENSUALIDAD', PLAN: x.PLAN }))}<small>${soles(x.TARIFA)} · ${esc(x.ESTADO)}</small></label>`).join('')}</div>
      <p class="sub" id="notaDuo"></p>
      <div id="quedaWrap" hidden><label><span id="quedaTxt"></span><input id="quedaPrecio" type="number" step="0.10" inputmode="decimal"></label></div>
    </fieldset>` : ''}
    <p class="aviso" id="notaPpp" hidden></p>
    <label>Motivo<input id="motivo" value="Falta de pago"></label>
    <label class="check"><input type="checkbox" id="cobrarMes" checked> Cobrar el mes del corte</label>
    <button class="btn grande rojo" id="ok">EJECUTAR</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  const radiosAcc = () => [...vista().querySelectorAll('input[name="acc"]')];
  const accSel = () => (vista().querySelector('input[name="acc"]:checked') || {}).value || 'CORTAR';
  const cajas = () => [...vista().querySelectorAll('.srvDuo')];
  const elegidos = () => (paquete ? cajas().filter((c) => c.checked && !c.disabled).map((c) => servicioPorId(c.value)) : [s]);
  const queda = () => (paquete ? paquete.filter((x) => x.ESTADO !== 'Baja' && !elegidos().some((e) => e.ID_SERV === x.ID_SERV)) : []);
  const pintarDuo = (inicial) => {
    if (!paquete) return;
    const acc = accSel();
    cajas().forEach((c) => {
      // cortar o suspender solo aplica a servicios activos; la baja, a cualquiera que no esté de baja
      c.disabled = acc === 'BAJA' ? c.dataset.estado === 'Baja' : c.dataset.estado !== 'Activo';
      if (inicial || c.disabled) c.checked = !c.disabled && (acc !== 'BAJA' || c.value === s.ID_SERV);
    });
    const q = queda(), soloUno = acc === 'BAJA' && q.length === 1 && elegidos().length > 0;
    $('#notaDuo').textContent = acc === 'BAJA'
      ? (soloUno ? `Se quita ${elegidos().map((e) => nombreServicio(e.PLAN)).join(' + ')} del paquete. El cliente sigue con ${nombreServicio(q[0].PLAN)}.` : 'Baja de todos los servicios marcados.')
      : 'Si cualquiera de los dos se atrasa, se corta el cliente completo (los dos marcados).';
    $('#quedaWrap').hidden = !soloUno;
    if (soloUno) {
      $('#quedaTxt').textContent = `Nuevo precio de ${nombreServicio(q[0].PLAN)} desde el mes siguiente (hoy ${soles(q[0].TARIFA)}; déjelo igual si no cambia)`;
      if (!$('#quedaPrecio').dataset.serv || $('#quedaPrecio').dataset.serv !== q[0].ID_SERV) { $('#quedaPrecio').value = Number(q[0].TARIFA) || ''; $('#quedaPrecio').dataset.serv = q[0].ID_SERV; }
    }
  };
  // el PPPoE es del INTERNET: se libera solo si se corta / da de baja el internet (la suspensión lo reserva)
  const pintarPpp = () => {
    const acc = accSel(), conPpp = elegidos().filter((x) => x.PPPOE && !esCatv(x)), conservado = (paquete || [s]).find((x) => x.PPPOE && !esCatv(x));
    const n = $('#notaPpp');
    n.hidden = !conservado;
    if (!conservado) return;
    n.innerHTML = `${ic('router')}<span>${acc === 'SUSPENDER' ? `El PPPoE ${esc(conservado.PPPOE)} queda reservado.`
      : conPpp.length ? `Se libera el PPPoE ${esc(conPpp.map((x) => x.PPPOE).join(', '))}.` : `El PPPoE ${esc(conservado.PPPOE)} se conserva (es del internet).`}</span>`;
  };
  if (paquete) {
    radiosAcc().forEach((r) => { r.onchange = () => { $('#motivo').value = accSel() === 'BAJA' ? 'Solo quiere un servicio' : 'Falta de pago'; pintarDuo(true); pintarPpp(); }; });
    cajas().forEach((c) => { c.onchange = () => { pintarDuo(false); pintarPpp(); }; });
    pintarDuo(true);
  } else radiosAcc().forEach((r) => { r.onchange = pintarPpp; });
  pintarPpp();
  $('#ok').onclick = async () => {
    const motivo = $('#motivo').value.trim();
    if (motivo.length < 3) return aviso('Indique el motivo.', 'error');
    const accion = accSel(), servs = elegidos();
    if (!servs.length) return aviso('Marque al menos un servicio.', 'error');
    const q = queda(), soloUno = paquete && accion === 'BAJA' && q.length === 1;
    const nuevoPrecio = soloUno ? Number($('#quedaPrecio').value || 0) : 0;
    if (soloUno && !(nuevoPrecio > 0)) return aviso('Escriba el precio del servicio que se queda.', 'error');
    const cambiaPrecio = soloUno && r2(nuevoPrecio) !== r2(Number(q[0].TARIFA));
    const titulo = `¿${ACC_CORTE.find((a) => a.v === accion).t}?`;
    if (!(await confirmar(`${s.CLIENTE}\n${servs.map((x) => x.ID_SERV + ' ' + nombreServicio(x.PLAN)).join(' + ')}` +
      (cambiaPrecio ? `\n${nombreServicio(q[0].PLAN)}: ${soles(q[0].TARIFA)} → ${soles(nuevoPrecio)} desde el mes siguiente` : ''), { titulo, si: 'Ejecutar', peligro: true }))) return;
    for (const x of servs) await encolar({ tipo: accion, idServ: x.ID_SERV, idCliente: x.ID_CLIENTE, motivo, fecha: hoyISO(), cobrarMesCorte: $('#cobrarMes').checked });
    if (cambiaPrecio) {
      const d = new Date(hoyISO() + 'T00:00:00'); d.setMonth(d.getMonth() + 1, 1);
      await encolar({ tipo: 'CAMBIAR_PLAN', idServ: q[0].ID_SERV, idCliente: q[0].ID_CLIENTE, plan: q[0].PLAN, tarifa: nuevoPrecio,
        fecha: d.toISOString().slice(0, 10) });
    }
    aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    if (accion === 'CORTAR' && (await confirmar('Se abrirá WhatsApp con el aviso de corte.', { titulo: '¿Avisar al cliente?', si: 'Avisar', no: 'No' }))) await enviarWhatsApp(s.ID_CLIENTE, plantilla('MsgCorte', s.ID_CLIENTE));
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

function vReactivar(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  const disp = pppoeDisponibles();
  const r = D.resumen[s.ID_CLIENTE] || {};
  const propio = s.PPPOE ? [s.PPPOE] : [];
  const planes = D.planes.filter((p) => p.ACTIVO !== 'No' || p.PLAN === s.PLAN);
  // paquete DUO: el otro servicio cortado/suspendido se reactiva junto (marcado por defecto)
  const duo = serviciosDuo(s.ID_CLIENTE);
  // dado de baja: los otros servicios de baja del cliente (ej. el CATV de su paquete) pueden volver juntos
  const deBaja = s.ESTADO === 'Baja';
  const otros = deBaja ? serviciosDe(s.ID_CLIENTE).filter((x) => x.ID_SERV !== s.ID_SERV && x.ESTADO === 'Baja')
    : duo && duo.todos.some((x) => x.ID_SERV === s.ID_SERV)
    ? duo.todos.filter((x) => x.ID_SERV !== s.ID_SERV && (x.ESTADO === 'Cortado' || x.ESTADO === 'Suspendido') && !pausaDe(x.ID_SERV)) : [];
  // paquete: si se entró por el CATV, se abre el del INTERNET (lleva el PPPoE) y el CATV va junto
  const inetJunto = esCatv(s) && otros.find((x) => !esCatv(x));
  if (inetJunto) { location.replace('#/reactivar/' + encodeURIComponent(inetJunto.ID_SERV)); return; }
  vista().innerHTML = `<section class="form"><h2>${deBaja ? 'Volver a activar' : 'Reactivar servicio'}</h2>
    ${deBaja ? `<p class="aviso">${ic('info')}<span>Estaba dado de baja${s.FECHA_FIN ? ' desde el ' + esc(txtFecha(s.FECHA_FIN)) : ''}. Vuelve a cobrarse desde la fecha que elija (el primer mes por días). Su deuda anterior se mantiene.</span></p>` : ''}
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.ESTADO)} · PPPoE anterior ${esc(s.PPPOE_ANT || '-')}</p>
    ${Number(r.DEUDA_VENCIDA) > 0 ? `<p class="aviso error">Aún debe ${soles(r.DEUDA_VENCIDA)}. <a href="#/cobrar/${esc(s.ID_CLIENTE)}">Cobrar primero</a> (puede reactivar igual).</p>` : ''}
    <label>Plan<select id="plan">${planes.map((p) => `<option data-t="${Number(p.TARIFA)}" ${p.PLAN === s.PLAN ? 'selected' : ''}>${esc(p.PLAN)}</option>`).join('')}</select></label>
    <label>Tarifa mensual (S/)<input id="tarifa" type="number" step="0.10" inputmode="decimal" value="${Number(s.TARIFA) || ''}"></label>
    <label>Fecha de reactivación<input id="fecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
    <label>Modo / equipo<select id="modoR"><option value="">— sin modo —</option>${opcionesModo(s.MODO)}</select></label>
    ${esCatv(s) ? `<input type="hidden" id="ppp" value=""><p class="globo">${ic('tv')}<span>Este es el servicio de <b>CATV</b> (cable): no lleva PPPoE. El PPPoE es solo del internet.</span></p>`
      : `<div><span class="etq">PPPoE del internet</span>${campoPPPoE('ppp', s.PPPOE || (disp.includes(s.PPPOE_ANT) ? s.PPPOE_ANT : ''), { permitir: propio, titulo: 'PPPoE del internet', paraQuien: s.CLIENTE })}</div>`}
    <div id="pror"></div>
    <label class="check"><input type="checkbox" id="manual"> Modificar el monto del primer mes manualmente</label>
    <div id="manualWrap" hidden><label>Monto del primer mes (S/)<div class="fila"><input id="primer" type="number" step="0.10" inputmode="decimal">
      <button type="button" class="mini" id="redondear">Redondear</button></div></label></div>
    ${otros.map((x) => `<label class="check"><input type="checkbox" class="otroDuo" value="${esc(x.ID_SERV)}" ${deBaja ? '' : 'checked'}> Reactivar también ${esc(nombreServicio(x.PLAN))} · ${soles(x.TARIFA)}${deBaja ? '' : ' (paquete DUO)'}</label>`).join('')}
    <label>Motivo<input id="motivo" value="${deBaja ? 'Vuelve como cliente' : 'Reactivación por pago'}"></label>
    <button class="btn grande verde" id="ok">${ic('check')}Reactivar</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  let calc = null, mesCobrado = false;
  const tarifa = () => Number($('#tarifa').value || 0);
  const pintar = () => {
    const fe = $('#fecha').value || hoyISO(), mes = fe.slice(0, 7);
    // si la cuota de ese mes sigue vigente (ej. se cortó este mismo mes cobrándolo) no se prorratea
    mesCobrado = D.cargos.some((k) => k.ID_SERV === s.ID_SERV && k.CONCEPTO === 'MENSUALIDAD' && String(k.PERIODO).startsWith(mes));
    calc = prorrateoPlan(0, tarifa(), fe);
    const dia = Number(fe.slice(8, 10));
    $('#pror').innerHTML = !(tarifa() > 0) ? '' : mesCobrado
      ? `<p class="aviso">La cuota de ${esc(txtPeriodo(fe))} ya existe (el corte fue este mismo mes): se mantiene como está.</p>`
      : `<div class="hero calculo"><span class="eyebrow">Primer mes · ${esc(txtPeriodo(fe))} (${calc.diasMes} días)</span>
        <table class="periodos"><tbody><tr><td>${dia === 1 ? 'Mes completo' : calc.restantes + ' día(s) desde el ' + esc(txtFecha(fe))}</td><td>${soles(calc.conNueva)}</td></tr></tbody></table>
        <p class="sub">Desde el mes siguiente: ${soles(tarifa())} al mes.</p></div>`;
    $('#manual').closest('label').hidden = mesCobrado;
    if (!$('#manual').checked) $('#primer').value = calc.conNueva.toFixed(2);
  };
  $('#plan').onchange = (e) => { const o = e.target.selectedOptions[0]; if (o && o.dataset.t) $('#tarifa').value = o.dataset.t; pintar(); };
  $('#tarifa').oninput = pintar;
  $('#fecha').onchange = pintar;
  $('#manual').onchange = () => { $('#manualWrap').hidden = !$('#manual').checked; if (!$('#manual').checked) pintar(); };
  $('#redondear').onclick = () => { $('#primer').value = Math.round(Number($('#primer').value || 0)).toFixed(2); };
  pintar();
  $('#ok').onclick = async () => {
    if (!(tarifa() > 0)) return aviso('La tarifa debe ser mayor a 0.', 'error');
    const fe = $('#fecha').value || hoyISO(), manual = $('#manual').checked && !mesCobrado, primer = Number($('#primer').value);
    if (manual && !(primer >= 0)) return aviso('Escriba el monto del primer mes.', 'error');
    const cambioPlan = $('#plan').value !== s.PLAN;
    if (!(await confirmar(`${s.ID_SERV} de ${s.CLIENTE}\n${cambioPlan ? s.PLAN + ' → ' : ''}${$('#plan').value} · ${soles(tarifa())}/mes` +
      (mesCobrado ? '' : `\nPrimer mes (${txtPeriodo(fe)}): ${soles(manual ? primer : calc.conNueva)}`), { titulo: '¿Reactivar servicio?', si: 'Reactivar' }))) return;
    await encolar({ tipo: 'REACTIVAR', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, codigoPPPoE: $('#ppp').value, plan: $('#plan').value,
      modo: $('#modoR').value || undefined, tarifa: tarifa(), motivo: $('#motivo').value.trim() || 'Reactivación', fecha: fe,
      datos: manual ? { prorratear: true, montoPrimerMes: r2(primer) } : { prorratear: true } });
    for (const c of vista().querySelectorAll('.otroDuo:checked')) {
      const x = servicioPorId(c.value);           // el CATV vuelve con su propio plan y precio, sin PPPoE
      await encolar({ tipo: 'REACTIVAR', idServ: x.ID_SERV, idCliente: x.ID_CLIENTE, codigoPPPoE: '', plan: x.PLAN, tarifa: Number(x.TARIFA), modo: $('#modoR').value || undefined,
        motivo: $('#motivo').value.trim() || 'Reactivación', fecha: fe, datos: { prorratear: true } });
    }
    aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

/** Desde el inventario: elegir a qué cliente (servicio activo sin PPPoE) se asigna un código Disponible. */
function asignarDesdePPPoE(cod, alTerminar) {
  const p = D.pppoe.find((x) => String(x.CODIGO) === String(cod)) || {};
  const libres = D.servicios.filter((s) => s.ESTADO === 'Activo' && !s.PPPOE && !esCatv(s));   // el CATV nunca lleva PPPoE
  const m = modal(`<h3 id="dlgT">Asignar ${esc(cod)}</h3><p class="sub">Titular: ${esc(p.TITULAR || '-')}. Solo se muestran servicios de INTERNET activos sin PPPoE (${libres.length}). En un paquete DUO va al INTERNET; el CATV no usa PPPoE.</p>
    <input id="asQ" class="buscador" type="search" placeholder="Nombre, DNI, código o zona" autocomplete="off" aria-label="Buscar cliente">
    <ul class="lista" id="asRes"></ul><button class="btn secundario" id="asNo">Cancelar</button>`);
  const pintarRes = () => {
    const q = $('#asQ').value.trim().toLowerCase();
    const lista = libres.filter((s) => { const c = D.porId[s.ID_CLIENTE] || {};
      return !q || [s.CLIENTE, s.ID_CLIENTE, s.ID_SERV, c.DNI_RUC, c.ZONA, s.PLAN].some((v) => String(v || '').toLowerCase().includes(q)); }).slice(0, 40);
    $('#asRes').innerHTML = lista.map((s) => `<li><a href="#" data-serv="${esc(s.ID_SERV)}"><div><b>${esc(s.CLIENTE)}</b>
      <small>${esc(s.ID_CLIENTE)} · ${esc(s.ID_SERV)} · <span class="chip e-activo">${ic('router')}INTERNET</span> ${esc(s.PLAN)} · ${esc((D.porId[s.ID_CLIENTE] || {}).ZONA || '')}</small></div>${ic('flecha', 'fin')}</a></li>`).join('')
      || '<li class="vacio">Ningún servicio activo sin PPPoE coincide.</li>';
    $('#asRes').querySelectorAll('[data-serv]').forEach((a) => { a.onclick = async (e) => {
      e.preventDefault();
      const s = servicioPorId(a.dataset.serv);
      cerrarModal();
      if (!(await confirmar(`${cod} (${p.TITULAR || 'sin titular'})\n→ ${s.CLIENTE} · ${s.ID_SERV}`, { titulo: '¿Asignar este PPPoE?', si: 'Asignar' }))) return;
      await encolar({ tipo: 'ASIGNAR_PPPOE', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, codigoPPPoE: cod, fecha: hoyISO() });   // se ve al instante (aplicarPendientes)
      aviso(navigator.onLine ? 'Asignado.' : 'Guardado: se enviará al volver la señal.');
      if (alTerminar) alTerminar();
    }; });
  };
  $('#asQ').addEventListener('input', pintarRes);
  $('#asNo').onclick = cerrarModal;
  pintarRes();
  $('#asQ').focus();
}

/** Opción de PPPoE con su titular (el valor sigue siendo solo el código). */
function optPPPoE(cod, sel = false) {
  const p = D.pppoe.find((x) => String(x.CODIGO) === String(cod)) || {};
  return `<option value="${esc(cod)}" ${sel ? 'selected' : ''}>${esc(cod)}${p.TITULAR ? ' · ' + esc(p.TITULAR) : ''}</option>`;
}

// ---- PPPoE: piezas compartidas (inventario, ventana de elegir, alta, reactivar) -------------
/** Historial agrupado por código (el más reciente primero). */
function histPorCodigo() {
  const hist = {};
  D.histPPPoE.forEach((h) => { (hist[h.CODIGO] = hist[h.CODIGO] || []).push(h); });
  Object.values(hist).forEach((l) => l.sort((x, y) => String(y.F_DESDE).localeCompare(String(x.F_DESDE))));
  return hist;
}
/** Busca por código, titular, cliente actual o un cliente que lo usó antes. */
const coincidePPPoE = (p, q, hist) => !q || [p.CODIGO, p.CLIENTE, p.ID_CLIENTE, p.TITULAR].some((v) => String(v || '').toLowerCase().includes(q)) ||
  (hist[p.CODIGO] || []).some((h) => String(h.CLIENTE || '').toLowerCase().includes(q));
const chipPPPoE = (e) => (e === 'Disponible' ? 'e-activo' : e === 'Asignado' ? 'e-pend' : 'e-moroso');
const marcaPend = (x) => (x && x._pend ? `<span class="chip e-porvencer pend-local" title="Guardado en este celular; se enviará solo">${ic('reloj')}por enviar</span>` : '');

/**
 * VENTANA FLOTANTE para elegir un PPPoE (alta, nuevo servicio, reactivar, asignar).
 * Lista los Disponibles con buscador; "Todos" muestra también los ocupados (no se pueden elegir).
 * permitir: códigos ocupados que igual se pueden elegir (ej. el que el cliente ya tenía).
 * Devuelve el código elegido, '' (sin PPPoE) o null (cancelar).
 */
function elegirPPPoE({ actual = '', permitir = [], titulo = 'Elegir PPPoE', paraQuien = '' } = {}) {
  return new Promise((ok) => {
    let filtro = 'Disponible';
    const hist = histPorCodigo(), libres = D.pppoe.filter((p) => p.ESTADO === 'Disponible').length;
    const m = modal(`<h3 id="dlgT" class="tit-ic">${ic('router')}${esc(titulo)}</h3>
      ${paraQuien ? `<p class="sub">Para: <b>${esc(paraQuien)}</b></p>` : ''}
      <p class="globo">${ic('info')}<span>Toque un código <b>Disponible</b>. Puede buscar por código, titular o por un cliente que lo usó antes.</span></p>
      <input id="epQ" class="buscador" type="search" placeholder="Código, titular o cliente anterior" autocomplete="off" inputmode="search" aria-label="Buscar PPPoE">
      <div class="acciones-sel" id="epF"></div><p class="sub" id="epT"></p>
      <ul class="lista ep-lista" id="epL"></ul>
      <div class="acciones"><button class="btn" id="epNo">Cancelar</button><button class="btn" id="epSin">Sin PPPoE (asignar después)</button></div>`);
    prepararDialogo(m, () => ok(null));
    const fin = (v) => { cerrarModal(); ok(v); };
    const elegible = (p) => p.ESTADO === 'Disponible' || permitir.map(String).includes(String(p.CODIGO));
    const pintar = () => {
      const q = $('#epQ').value.trim().toLowerCase();
      $('#epF').innerHTML = [['Disponible', `Disponibles (${libres})`], ['Todos', 'Todos']].map(([v, t]) =>
        `<button class="mini ${v === filtro ? 'sel' : ''}" data-f="${v}" aria-pressed="${v === filtro}">${t}</button>`).join('');
      const lista = D.pppoe.filter((p) => (filtro === 'Todos' || elegible(p)) && coincidePPPoE(p, q, hist))
        .sort((x, y) => (q && String(y.CODIGO).toLowerCase() === q) - (q && String(x.CODIGO).toLowerCase() === q) || elegible(y) - elegible(x));
      $('#epT').textContent = lista.length > 40 ? `${lista.length} códigos · mostrando 40. Escriba para afinar.` : `${lista.length} código(s)`;
      $('#epL').innerHTML = lista.slice(0, 40).map((p) => {
        const sirve = elegible(p), ant = (hist[p.CODIGO] || []).find((h) => h.F_HASTA);
        return `<li><button type="button" class="ep-item ${sirve ? '' : 'apagado'} ${String(p.CODIGO) === String(actual) ? 'sel' : ''}" data-c="${esc(p.CODIGO)}" ${sirve ? '' : 'disabled'}>
          <span class="ep-ic">${ic('router')}</span>
          <span class="ep-txt"><b>${esc(p.CODIGO)}</b><small>Titular: ${esc(p.TITULAR || '-')}</small>
            ${!sirve && p.CLIENTE ? `<small>Lo usa: ${esc(p.CLIENTE)}</small>` : ant ? `<small>Antes: ${esc(ant.CLIENTE)}${ant.F_HASTA ? ' (hasta ' + esc(txtFecha(ant.F_HASTA)) + ')' : ''}</small>` : ''}</span>
          <span class="chip ${chipPPPoE(p.ESTADO)}">${esc(p.ESTADO)}</span></button></li>`;
      }).join('') || `<li class="vacio">${filtro === 'Disponible' && !q ? 'No hay códigos disponibles. Agréguelos en Más → PPPoE.' : 'Ningún código coincide.'}</li>`;
      $('#epF').querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; pintar(); }; });
      $('#epL').querySelectorAll('[data-c]:not([disabled])').forEach((b) => { b.onclick = () => fin(b.dataset.c); });
    };
    $('#epQ').addEventListener('input', pintar);
    $('#epNo').onclick = () => fin(null);
    $('#epSin').onclick = () => fin('');
    pintar();
    $('#epQ').focus();
  });
}

/**
 * Campo PPPoE para formularios: un input oculto (mismo id de siempre, así el formulario lo lee
 * igual) + un botón grande que abre la ventana de elegir. ops: { permitir, titulo, paraQuien }.
 */
const OPS_PPP = {};
function campoPPPoE(id, actual = '', ops = {}) {
  OPS_PPP[id] = ops;
  return `<div class="campo-ppp"><input type="hidden" id="${id}" value="${esc(actual)}">
    <button type="button" class="ppp-elegir" data-elegirppp="${id}" aria-label="Elegir PPPoE">${textoCampoPPPoE(actual)}</button></div>`;
}
function textoCampoPPPoE(cod) {
  const p = cod && D.pppoe.find((x) => String(x.CODIGO) === String(cod));
  return cod ? `${ic('router')}<span class="ppp-txt"><b>${esc(cod)}</b><small>${esc((p && p.TITULAR) || '')}</small></span><span class="ppp-cambiar">Cambiar</span>`
    : `${ic('router')}<span class="ppp-txt"><b>Elegir PPPoE</b><small>Toque para buscar un código disponible</small></span>${ic('flecha', 'fin')}`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-elegirppp]');
  if (!b) return;
  e.preventDefault();
  const id = b.dataset.elegirppp, inp = document.getElementById(id);
  const v = await elegirPPPoE(Object.assign({ actual: inp.value }, OPS_PPP[id] || {}));
  if (v === null) return;
  inp.value = v;
  b.innerHTML = textoCampoPPPoE(v);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  b.focus();
});

// ---- MÁS -------------------------------------------------------------------------------
function vMas() {
  vista().innerHTML = `<h2>Más opciones</h2>
    <h3>Operación</h3>
    ${tarjetasAccion([
      { href: '#/nuevo', icono: 'nuevoCliente', t: 'Nuevo cliente', sub: 'Registro por pasos', color: 'verde' },
      { href: '#/ordenes', icono: 'lista', t: 'Órdenes y rutas', sub: 'Pendientes por zona', color: 'azul' },
      { href: '#/mapa', icono: 'mapa', t: 'Mapa general', sub: 'Clientes y órdenes por color', color: 'cian' },
      { href: '#/cortar', icono: 'cortar', t: 'A cortar', sub: '30 días o más', color: 'rojo' },
      { href: '#/convenios', icono: 'calculadora', t: 'Convenios', sub: 'Cuotas y castigos', color: 'ambar' },
    ], 'dos')}
    <h3>Reportes</h3>
    ${tarjetasAccion([
      { href: '#/dashboard', icono: 'grafico', t: 'Dashboard', sub: 'Recaudación y morosidad', color: 'violeta' },
      { href: '#/movimientos', icono: 'reloj', t: 'Movimientos', sub: 'Cortes, altas, cambios', color: 'cian' },
      { href: '#/hoy', icono: 'recibo', t: 'Mis cobros', sub: 'Total del día', color: 'verde' },
    ], 'dos')}
    <h3>Inventario</h3>
    ${tarjetasAccion([{ href: '#/pppoe', icono: 'router', t: 'PPPoE', sub: 'Disponibles, asignados, bloqueados', color: 'gris' }])}
    <h3>Administración</h3>
    ${tarjetasAccion([{ href: '#/perfil', icono: 'ajustes', t: 'Perfil y ajustes', sub: 'Negocio, cuentas, planes, avisos', color: 'azul' }])}`;
}

// ---- PERFIL DE ADMINISTRADOR (tocar el avatar): ajustes del negocio y de la app ----------------
async function vPerfil() {
  const pend = (await pendientesDeEnvio()).length;
  vista().innerHTML = `<section class="perfil"><div class="cuenta-perfil"><span class="avatar grande" aria-hidden="true">${esc(iniciales(PERFIL.nombre))}</span>
      <div><b>${esc(PERFIL.nombre)}</b><small>${esc(PERFIL.email)} · ${esc(PERFIL.rol)}</small><small>Versión ${esc(CONFIG.VERSION)}${pend ? ` · ${pend} por enviar` : ''}</small></div></div>
    <h3>Negocio</h3>
    ${tarjetasAccion([
      { href: '#/negocio/datos', icono: 'documento', t: 'Datos del negocio', sub: 'RUC, dirección, teléfono', color: 'azul' },
      { href: '#/negocio/cobro', icono: 'cobrar', t: 'Cuentas de cobro', sub: 'Yape, BCP, B. Nación', color: 'verde' },
      { href: '#/negocio/mensajes', icono: 'chat', t: 'Mensajes WhatsApp', sub: 'Cobranza, corte, recibo', color: 'cian' },
      { href: '#/config', icono: 'ajustes', t: 'Planes y listas', sub: 'Tarifas, zonas, modos', color: 'violeta' },
    ], 'dos')}
    <h3>App</h3>
    ${tarjetasAccion([
      { href: '#/recordatorios', icono: 'campana', t: 'Recordatorios', sub: 'Avisos de órdenes', color: 'ambar' },
      { href: '#/cuenta', icono: 'usuario', t: 'Mi cuenta', sub: 'Tema, sincronizar, salir', color: 'gris' },
      { href: '#/guia', icono: 'info', t: 'Cómo funciona', sub: 'Colores, íconos y señal', color: 'azul' },
      { href: '#/mapa', icono: 'mapa', t: 'Mapa general', sub: 'Clientes y órdenes', color: 'cian' },
    ], 'dos')}</section>`;
}

// ---- CÓMO FUNCIONA: guía corta para el técnico (dibujos y colores, poco texto) --------------
function vGuia() {
  const bloque = (icono, color, titulo, items) => `<div class="tarjeta-form guia"><h3 class="tit-ic"><span class="ta-ic c-${color}">${ic(icono)}</span>${esc(titulo)}</h3>
    <ul class="guia-lista">${items.map(([i, c, t]) => `<li><span class="mk mk-${c}">${ic(i)}</span><span>${t}</span></li>`).join('')}</ul></div>`;
  vista().innerHTML = `<section class="form"><a class="volver" href="#/perfil">${ic('atras')}Perfil</a>
    <h2 class="tit-ic">${ic('info')}Cómo funciona</h2>
    ${bloque('sync', 'azul', 'Señal y envío de datos', [
      ['check', 'verde', '<b>En línea:</b> lo que registra se envía solo en segundos.'],
      ['alerta', 'ambar', '<b>Sin señal:</b> siga trabajando. Todo queda guardado en el celular y se envía solo al volver la señal.'],
      ['reloj', 'ambar', '<b>Por enviar:</b> cambios guardados que aún no llegan. En la lista se ven con la marca <span class="chip e-porvencer">por enviar</span>.'],
      ['sync', 'azul', '<b>Act. hace N min:</b> cuándo llegaron los cambios de los otros técnicos. Se actualiza solo cada 3 minutos.'],
      ['usuario', 'rojo', '<b>Sesión vencida:</b> toque "Continuar con Google" en el aviso. No hace falta cerrar sesión ni perder nada.'],
    ])}
    ${bloque('router', 'gris', 'PPPoE', [
      ['check', 'verde', '<b>Disponible:</b> libre para un cliente nuevo.'],
      ['usuario', 'azul', '<b>Asignado:</b> lo usa un cliente.'],
      ['cerrar', 'rojo', '<b>Bloqueado:</b> no se debe usar.'],
      ['tv', 'violeta', 'Solo el <b>INTERNET</b> lleva PPPoE. El CATV (cable) nunca, aunque sea un paquete DUO.'],
      ['buscar', 'azul', 'Al registrar, toque <b>Elegir PPPoE</b>: se abre una ventana con buscador (código, titular o cliente anterior).'],
    ])}
    ${bloque('mapa', 'cian', 'Mapa general', [
      ['lista', 'azul', '<b>Cuadrado:</b> orden pendiente (el dibujo dice el tipo).'],
      ['cortar', 'rojo', '<b>Rojo:</b> cliente a cortar.'],
      ['alerta', 'ambar', '<b>Ámbar:</b> moroso.'],
      ['check', 'verde', '<b>Verde:</b> al día.'],
      ['reloj', 'gris', '<b>Gris:</b> cortado o suspendido.'],
      ['camara', 'cian', 'Botones <b>Calles · Satélite · Terreno</b>: el terreno muestra cerros y ríos para guiarse en el campo.'],
    ])}
    ${bloque('campana', 'ambar', 'Recordatorios', [
      ['campana', 'ambar', 'Cada día avisa de las órdenes de <b>hoy</b> y las <b>atrasadas</b>, hasta que se marquen como hechas.'],
      ['calendario', 'azul', 'Con la app cerrada avisa el calendario de Google "D@NDINET Órdenes" (se repite cada día).'],
    ])}
    ${bloque('calculadora', 'verde', 'Cliente nuevo', [
      ['calculadora', 'verde', 'El primer mes se calcula por días. Si acordó otro precio, toque la cifra y cámbiela.'],
      ['ajustes', 'violeta', 'Gastos de instalación (mano de obra, materiales…) salen detallados en el recibo.'],
    ])}
    <p class="sub">Toque el ícono ${ic('info')} de cada pantalla para ver su explicación.</p></section>`;
}

// ---- NUEVO / EDITAR CLIENTE --------------------------------------------------------
const lst = (tipo) => D.listas.filter((x) => x.TIPO === tipo && x.ACTIVO !== 'No').sort((a, b) => Number(a.ORDEN) - Number(b.ORDEN)).map((x) => x.VALOR);
const docOk = (v) => /^\d{8}$/.test(v) || /^(10|15|17|20)\d{9}$/.test(v);
const telOk = (v) => /^9\d{8}$/.test(v);

// Alta y edición de cliente por pasos: 1 Cliente · 2 Servicio · 3 WiFi/Router · 4 Cobro inicial (editar: 1 y 3).
const INST_CONCEPTOS = ['Mano de obra', 'Instalación', 'Accesorios', 'Materiales', 'Equipo (ONU / router)', 'Otro'];
const AYUDA_PRORRATEO = 'El primer mes se cobra solo por los días que quedan, desde el día de instalación.\n' +
  'Ej.: plan S/ 50, instala el 20 de octubre (31 días) → 12 días → 50 × 12 ÷ 31 = S/ 19.35.\nDesde el mes siguiente paga el mes completo.';
const AYUDA_DUO = 'Plan con TV (INTERNET + CATV): el sistema lo guarda como dos servicios que se cobran y cortan juntos.\n' +
  'Si marca "Separar", el internet vale el precio del plan menos el CATV.\nEj.: plan S/ 75, CATV S/ 25 → INTERNET S/ 50 + CATV S/ 25.\nEl PPPoE va en el internet.';

function vFormCliente(id) {
  const editar = RUTA === 'editar';
  const c = editar ? D.porId[id] : {};
  if (editar && !c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const campo = (k, etq, extra = '') => `<label>${etq}<input id="f_${k}" value="${esc(c[k] !== undefined ? c[k] : '')}" ${extra}></label>`;
  // claves WiFi/router: al editar se piden al servidor; mientras no lleguen, el campo está bloqueado
  // y NO se envía (así un cambio hecho sin señal nunca borra las claves guardadas)
  const CLAVES = ['USUARIO_WIFI', 'CLAVE_WIFI', 'USUARIO_ROUTER', 'CLAVE_ROUTER'];
  let clavesOk = !editar;
  const bloq = editar ? 'disabled placeholder="Cargando…"' : '';
  const planes = D.planes.filter((p) => p.ACTIVO !== 'No');
  const planCatv = D.planes.find((p) => esCatv(p) && p.ACTIVO !== 'No');
  const planesInet = planes.filter((p) => /INTERNET/i.test(p.PLAN) && !planIncluyeTV(p.PLAN));
  const pasos = editar ? [['cliente', 'Cliente', 'usuario'], ['wifi', 'WiFi y router', 'wifi']]
    : [['cliente', 'Cliente', 'usuario'], ['servicio', 'Servicio', 'router'], ['wifi', 'WiFi y router', 'wifi'], ['cobro', 'Cobro inicial', 'cobrar']];
  vista().innerHTML = `<section class="form asistente"><h2>${editar ? 'Editar cliente' : 'Nuevo cliente'}</h2>
    ${editar ? `<p class="sub">${esc(id)} · ${esc(c.NOMBRES)}</p>` : ''}
    <ol class="pasos">${pasos.map(([k, t, i], n) => `<li data-ir="${n}">${ic(i)}<span>${n + 1}. ${esc(t)}</span></li>`).join('')}</ol>

    <div class="paso" data-paso="cliente">
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('usuario')}Datos del cliente ${ayuda('DNI / RUC', 'Escriba el DNI (8 dígitos) o RUC (11) y toque Consultar: el nombre se llena solo.\nSi no hay señal, escríbalo a mano.')}</h3>
      <label>DNI o RUC *<div class="fila"><input id="f_DNI_RUC" value="${esc(c.DNI_RUC || '')}" inputmode="numeric" maxlength="11"><button type="button" class="mini" id="btnDni">${ic('buscar')}Consultar</button></div></label>
      ${campo('NOMBRES', 'Nombres y apellidos / razón social *', 'autocapitalize="characters"')}
      <div class="dos">${campo('TELEFONO', 'Celular *', 'inputmode="numeric" maxlength="9"')}${campo('TELEFONO2', 'Celular 2', 'inputmode="numeric" maxlength="9"')}</div></div>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('ubicacion')}Dónde vive ${ayuda('Ubicación', '"Aquí" toma la posición del GPS del celular (úselo estando en la casa del cliente).\n"Mapa" permite marcar el punto a mano.\nSirve para que el técnico llegue con Google Maps.')}</h3>
      ${campo('DIRECCION', 'Dirección *')}${campo('REFERENCIA', 'Referencia')}
      <label>Zona *<select id="f_ZONA"><option value="">— elegir —</option>${lst('ZONA').map((z) => `<option ${z === c.ZONA ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
      <label>Ubicación<div class="fila"><input id="f_COORDENADAS" value="${esc(c.COORDENADAS || '')}" placeholder="-11.44, -74.43"><button type="button" class="mini" id="gps">${ic('ubicacion')}Aquí</button><button type="button" class="mini" id="btnMapa">${ic('mapa')}Mapa</button></div></label></div>
      <details class="plegable"><summary><span>Más datos (opcional)</span>${ic('abajo')}</summary><div class="plegable-cuerpo">
        ${campo('DIA_VENC', 'Día de pago del mes (1–28)', `inputmode="numeric" placeholder="${esc(D.config.DiaVenc || 4)}"`)}
        ${campo('OBSERVACIONES', 'Observaciones')}</div></details>
    </div>

    ${editar ? '' : `<div class="paso" data-paso="servicio" hidden>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('router')}Servicio a contratar</h3>
      <label>Plan *<select id="s_plan"><option value="">— elegir —</option>${planes.map((p) => `<option data-t="${Number(p.TARIFA)}">${esc(p.PLAN)}</option>`).join('')}</select></label>
      <div class="dos"><label>Precio al mes (S/) *<input id="s_tarifa" type="number" step="0.10" inputmode="decimal"></label>
        <label>Inicio<input id="s_inicio" type="date" value="${hoyISO()}"></label></div>
      <label>Modo / equipo<select id="s_modo"><option value=""></option>${lst('MODO').map((m) => `<option>${esc(m)}</option>`).join('')}</select></label></div>
      <div class="tarjeta-form" id="s_duoBox" hidden><h3 class="tit-ic">${ic('tv')}Internet + TV cable ${ayuda('Paquete DUO', AYUDA_DUO)}</h3>
        <label class="check"><input type="checkbox" id="s_catv" checked> <span id="s_catvTxt">Separar en INTERNET + CATV</span></label>
        <div id="s_catvWrap">
          <label id="s_inetPlanWrap">Plan del internet<select id="s_inetPlan">${planesInet.map((p) => `<option>${esc(p.PLAN)}</option>`).join('')}</select></label>
          <div class="dos"><label>CATV (S/)<input id="s_catvT" type="number" step="0.10" inputmode="decimal" value="${Number((planCatv || {}).TARIFA) || 25}"></label>
            <label>Internet (S/)<input id="s_inetT" type="number" step="0.10" inputmode="decimal"></label></div>
          <p class="resumen-duo" id="s_catvTot"></p></div></div>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('router')}PPPoE del internet ${ayuda('PPPoE', 'Es el usuario de internet del cliente en el router de la empresa.\nSolo lo lleva el servicio de INTERNET: el CATV (cable) nunca usa PPPoE.\nPuede asignarlo ahora o después desde la ficha.')}</h3>
        <label class="check" id="s_pppForceWrap" hidden><input type="checkbox" id="s_pppForce"> Asignar PPPoE igual (este plan no es de internet)</label>
        <div id="s_pppWrap"><div id="s_pppNota"></div>${campoPPPoE('s_pppoe', '', { titulo: 'PPPoE del internet' })}</div></div>
    </div>`}

    <div class="paso" data-paso="wifi" hidden>
      <p class="aviso">${ic('llave')}<span>Opcional. Las claves se guardan aparte y solo se ven en la ficha tras el ícono de llave.</span></p>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('wifi')}WiFi del cliente</h3>${campo('USUARIO_WIFI', 'Nombre de la red', bloq)}${campo('CLAVE_WIFI', 'Clave WiFi', bloq)}</div>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('router')}Router / ONU</h3>${campo('USUARIO_ROUTER', 'Usuario', bloq)}${campo('CLAVE_ROUTER', 'Clave', bloq)}</div>
      ${editar ? '<p class="sub" id="clavesNota"></p>' : ''}
    </div>

    ${editar ? '' : `<div class="paso" data-paso="cobro" hidden>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('calculadora')}Primer mes ${ayuda('Primer mes por días', AYUDA_PRORRATEO + '\n\nPuede cambiar el monto si se acordó otro precio con el cliente: toque la cifra y escriba. El botón de flechas vuelve al cálculo.')}</h3><div id="cbMeses"></div></div>
      <div class="tarjeta-form"><h3 class="tit-ic">${ic('ajustes')}Instalación y gastos ${ayuda('Instalación', 'Opcional. Agregue lo que se cobra por la instalación: mano de obra, accesorios, materiales…\nSe suma en un solo cargo "Instalación" y el detalle queda anotado.')}</h3>
        <ul class="lista-limpia" id="cbInst"></ul><button type="button" class="mini" id="cbMas">${ic('agregar')}Agregar gasto</button></div>
      <div class="resumen-conv total-hoy">A cobrar al instalar <b id="cbTotal">S/ 0.00</b><small id="cbNota"></small></div>
      <label class="check"><input type="checkbox" id="cbCobrar" checked> Abrir "Cobrar" al terminar</label>
    </div>`}

    <div class="nav-pasos"><button class="btn" id="pAtras">${ic('atras')}Atrás</button><button class="btn verde" id="pSig">Siguiente${ic('flecha')}</button></div>
    <a class="btn secundario" href="${editar ? '#/cliente/' + esc(id) : '#/mas'}">Cancelar</a></section>`;

  // ---- navegación entre pasos ----
  let paso = 0;
  const ir = (n) => {
    paso = Math.max(0, Math.min(pasos.length - 1, n));
    vista().querySelectorAll('.paso').forEach((d) => { d.hidden = d.dataset.paso !== pasos[paso][0]; });
    vista().querySelectorAll('.pasos li').forEach((li, i) => { li.className = i < paso ? 'hecho' : i === paso ? 'actual' : ''; });
    $('#pAtras').disabled = paso === 0;
    const ult = paso === pasos.length - 1;
    $('#pSig').innerHTML = ult ? `${ic('check')}${editar ? 'Guardar cambios' : 'Registrar cliente'}` : `Siguiente${ic('flecha')}`;
    if (pasos[paso][0] === 'cobro') pintarCobro();
    window.scrollTo(0, 0);
  };
  const v = (k) => $('#f_' + k).value.trim();
  const validar = (k) => {
    if (k === 'cliente') {
      if (!docOk(v('DNI_RUC'))) return 'DNI de 8 dígitos o RUC de 11 (empieza con 10, 15, 17 o 20).';
      if (!v('NOMBRES')) return 'Escriba el nombre.';
      if (!telOk(v('TELEFONO'))) return 'Celular: 9 dígitos que empiezan con 9.';
      if (v('TELEFONO2') && !telOk(v('TELEFONO2'))) return 'Celular 2 inválido (o déjelo vacío).';
      if (!v('DIRECCION')) return 'Escriba la dirección.';
      if (!v('ZONA')) return 'Elija la zona.';
      if (v('DIA_VENC') && !(Number(v('DIA_VENC')) >= 1 && Number(v('DIA_VENC')) <= 28)) return 'Día de pago entre 1 y 28.';
      const rep = D.clientes.find((x) => x.DNI_RUC === v('DNI_RUC') && x.ID_CLIENTE !== id);
      if (rep) return `El DNI/RUC ya es de ${rep.ID_CLIENTE} ${rep.NOMBRES}.`;
    }
    if (k === 'servicio') {
      const s = servicio();
      if (!s.plan) return 'Elija el plan del servicio.';
      if (!(s.tarifa > 0)) return 'El precio debe ser mayor a 0.';
      if (s.catv && !(s.catv.tarifa > 0)) return 'El precio del CATV debe ser mayor a 0.';
      if (s.catv && !s.plan) return 'Elija el plan del internet.';
    }
    return '';
  };
  vista().querySelectorAll('.pasos li').forEach((li) => { li.onclick = () => {
    const n = Number(li.dataset.ir);
    for (let i = paso; i < n; i++) { const e = validar(pasos[i][0]); if (e) { ir(i); return aviso(e, 'error'); } }
    ir(n);
  }; });
  $('#pAtras').onclick = () => ir(paso - 1);
  $('#pSig').onclick = () => {
    const e = validar(pasos[paso][0]);
    if (e) return aviso(e, 'error');
    if (paso < pasos.length - 1) return ir(paso + 1);
    guardar();
  };

  // ---- servicio: plan con TV → se separa; plan de internet → TV aparte opcional; PPPoE solo con internet ----
  const tipoPlan = () => { const p = editar ? '' : $('#s_plan').value; return !p ? '' : planIncluyeTV(p) ? 'conTV' : /INTERNET/i.test(p) ? 'inet' : 'otro'; };
  function servicio() {
    if (editar) return {};
    const t = tipoPlan(), total = r2(Number($('#s_tarifa').value || 0)), conCatv = !$('#s_duoBox').hidden && $('#s_catv').checked;
    const catvT = r2(Number($('#s_catvT').value || 0));
    if (t === 'conTV' && conCatv) return { plan: $('#s_inetPlan').value, tarifa: r2(Number($('#s_inetT').value || 0)), catv: { tarifa: catvT }, total };
    if (t === 'inet' && conCatv) return { plan: $('#s_plan').value, tarifa: total, catv: { tarifa: catvT }, total: r2(total + catvT) };
    return { plan: $('#s_plan').value, tarifa: total, total };
  }
  const conInternet = () => { const t = tipoPlan(); return t === 'inet' || (t === 'conTV' && $('#s_catv').checked) || t === 'conTV'; };
  const pintarServ = () => {
    if (editar) return;
    const t = tipoPlan(), duoModo = /DUO/i.test($('#s_modo').value);
    $('#s_duoBox').hidden = !(t === 'conTV' || (t === 'inet' && duoModo) || (t === 'inet' && $('#s_catv').dataset.tocado === '1'));
    $('#s_catvTxt').textContent = t === 'conTV' ? 'Separar en INTERNET + CATV (recomendado)' : 'Agregar TV cable aparte (paquete DUO)';
    $('#s_inetPlanWrap').hidden = t !== 'conTV';
    $('#s_inetT').closest('label').hidden = t !== 'conTV';
    $('#s_catvWrap').hidden = !$('#s_catv').checked;
    const total = Number($('#s_tarifa').value || 0), catvT = Number($('#s_catvT').value || 0);
    if (t === 'conTV' && !$('#s_inetT').dataset.manual) $('#s_inetT').value = total > catvT ? r2(total - catvT).toFixed(2) : '';
    const s = servicio();
    $('#s_catvTot').innerHTML = s.catv ? `INTERNET <b>${soles(s.tarifa)}</b> + CATV <b>${soles(s.catv.tarifa)}</b> = <b>${soles(s.tarifa + s.catv.tarifa)}</b> al mes` : '';
    const inet = conInternet();
    $('#s_pppForceWrap').hidden = inet || !t;
    $('#s_pppWrap').hidden = !(inet || $('#s_pppForce').checked);
    $('#s_pppNota').innerHTML = s.catv ? `<p class="globo">${ic('tv')}<span>Se asigna al servicio de <b>INTERNET</b>. El CATV (cable) no usa PPPoE.</span></p>` : '';
  };
  if (!editar) {
    $('#s_plan').onchange = (e) => {
      const o = e.target.selectedOptions[0]; $('#s_tarifa').value = o && o.dataset.t ? o.dataset.t : ''; delete $('#s_inetT').dataset.manual;
      // plan con TV "INT-30(mbp)" → se propone el internet de la misma velocidad ("INTERNET 30mbp")
      const vel = (/(\d+)\s*\(?mbp/i.exec(e.target.value) || [])[1];
      const igual = vel && [...$('#s_inetPlan').options].find((x) => new RegExp('\\b' + vel + '\\s*mbp', 'i').test(x.value));
      if (igual) $('#s_inetPlan').value = igual.value;
      pintarServ();
    };
    $('#s_modo').onchange = () => { if (/DUO/i.test($('#s_modo').value)) $('#s_catv').checked = true; pintarServ(); };
    $('#s_inetT').oninput = () => { $('#s_inetT').dataset.manual = '1'; pintarServ(); };
    $('#s_catv').onchange = () => { $('#s_catv').dataset.tocado = '1'; pintarServ(); };
    ['#s_tarifa', '#s_catvT', '#s_pppForce'].forEach((x) => { $(x).addEventListener('input', pintarServ); $(x).addEventListener('change', pintarServ); });
    pintarServ();
  }

  // ---- cobro inicial: primer mes por días + instalación con detalle ----
  const agregarGasto = (concepto = 'Mano de obra', monto = '') => {
    const li = document.createElement('li'); li.className = 'gasto';
    li.innerHTML = `<select aria-label="Concepto">${INST_CONCEPTOS.map((x) => `<option ${x === concepto ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <input type="number" step="0.10" inputmode="decimal" placeholder="S/ 0.00" value="${esc(monto)}" aria-label="Monto">
      <button type="button" class="mini" aria-label="Quitar">${ic('cerrar')}</button>`;
    li.querySelector('button').onclick = () => { li.remove(); pintarCobro(); };
    li.querySelectorAll('input, select').forEach((x) => { x.oninput = pintarCobro; x.onchange = pintarCobro; });
    $('#cbInst').appendChild(li);
  };
  const gastos = () => [...vista().querySelectorAll('#cbInst .gasto')].map((li) => ({ concepto: li.querySelector('select').value, monto: r2(Number(li.querySelector('input').value || 0)) })).filter((g) => g.monto > 0);
  // el técnico puede cambiar el monto del primer mes (precio acordado); si cambia el plan o la fecha, vuelve al cálculo
  let manualPM = {}, baseManual = '';
  function pintarCobro() {
    if (editar) return;
    const s = servicio(), fe = $('#s_inicio').value || hoyISO(), dia = Number(fe.slice(8, 10));
    const base = [s.plan, s.tarifa, s.catv ? s.catv.tarifa : '', fe].join('|');
    if (base !== baseManual) { manualPM = {}; baseManual = base; }
    const prorr = D.config.ProrratearAlta !== 'No' && dia > 1;
    const linea = (k, nombre, t) => { const p = prorrateoPlan(0, t, fe), sug = prorr ? p.conNueva : r2(t);
      return { k, nombre, t, sug, m: manualPM[k] !== undefined ? manualPM[k] : sug, txt: prorr ? `${p.restantes} de ${p.diasMes} días` : 'mes completo' }; };
    const filas = [linea('inet', nombreServicio(s.plan) || 'Servicio', s.tarifa)].concat(s.catv ? [linea('catv', 'SERVICIO DE CATV', s.catv.tarifa)] : []);
    $('#cbMeses').innerHTML = `<table class="periodos pm-tabla"><tbody>${filas.map((f) => { const man = manualPM[f.k] !== undefined;
      return `<tr><td><b>${esc(f.nombre.replace(/^SERVICIO DE /, ''))}</b><small> ${esc(txtPeriodo(fe))} · ${esc(f.txt)}</small>${man ? `<small class="pm-sug">${ic('editar')}Cambiado a mano · cálculo ${soles(f.sug)}</small><button type="button" class="mini pm-rest" data-rest="${f.k}">${ic('sync')}Volver al cálculo</button>` : ''}</td>
        <td class="pm-celda"><span class="pm-caja ${man ? 'manual' : ''}"><span class="tenue">S/</span><input class="pm-in" data-k="${f.k}" type="number" min="0" step="0.10" inputmode="decimal" value="${r2(f.m).toFixed(2)}" aria-label="Primer mes ${esc(f.nombre)}"></span></td></tr>`; }).join('')}</tbody></table>
      <p class="sub">Desde ${esc(txtPeriodo(sumarMesTxt(fe.slice(0, 7), 1) + '-01'))}: ${soles(filas.reduce((t, f) => t + f.t, 0))} al mes.</p>`;
    $('#cbMeses').querySelectorAll('.pm-in').forEach((x) => {
      const f = filas.find((y) => y.k === x.dataset.k);
      x.oninput = () => { const v = r2(Math.max(0, Number(x.value || 0))); if (Math.abs(v - f.sug) < 0.005) delete manualPM[f.k]; else manualPM[f.k] = v; totalesCobro(); };
      x.onchange = () => pintarCobro();
    });
    $('#cbMeses').querySelectorAll('[data-rest]').forEach((b) => { b.onclick = () => { delete manualPM[b.dataset.rest]; pintarCobro(); }; });
    totalesCobro();
  }
  function totalesCobro() {
    const prim = [...vista().querySelectorAll('#cbMeses .pm-in')].reduce((t, x) => t + r2(Math.max(0, Number(x.value || 0))), 0);
    const inst = gastos().reduce((t, g) => t + g.monto, 0);
    $('#cbTotal').textContent = soles(prim + inst);
    $('#cbNota').textContent = `Primer mes ${soles(prim)}${inst ? ' + instalación ' + soles(inst) : ''}${Object.keys(manualPM).length ? ' (monto cambiado a mano)' : ''}`;
  }
  if (!editar) { $('#cbMas').onclick = () => { agregarGasto(); }; }

  // ---- claves al editar ----
  if (editar) {
    (async () => {
      const nota = $('#clavesNota');
      try {
        const k = await llamar('clavesCliente', { idCliente: id });
        if (!$('#f_CLAVE_WIFI')) return;              // el usuario ya salió del formulario
        CLAVES.forEach((x) => { const el = $('#f_' + x); el.value = k[x] || ''; el.disabled = false; el.placeholder = ''; });
        clavesOk = true;
      } catch (e) {
        if (!$('#f_CLAVE_WIFI')) return;
        CLAVES.forEach((x) => { $('#f_' + x).placeholder = '—'; });
        if (nota) nota.textContent = 'Las claves solo se editan con internet. Los demás datos sí se pueden guardar ahora; las claves no se tocarán.';
      }
    })();
  }
  $('#btnDni').onclick = async () => {
    const dni = $('#f_DNI_RUC').value.trim();
    if (!/^\d{8}$|^\d{11}$/.test(dni)) return aviso('Escriba primero el DNI (8 dígitos) o RUC (11).', 'error');
    const web = async () => {
      if (!(await confirmar('El número se copia para pegarlo en la página.', { titulo: '¿Abrir la consulta en la web?', si: 'Abrir' }))) return;
      navigator.clipboard && navigator.clipboard.writeText(dni).catch(() => {});
      window.open(dni.length === 11 ? 'https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp' : 'https://eldni.com/pe/buscar-datos-por-dni', '_blank', 'noopener');
    };
    if (!navigator.onLine) { aviso('Sin señal: no se puede consultar ahora.', 'error'); return; }
    $('#btnDni').disabled = true; $('#btnDni').innerHTML = `${ic('sync', 'girando')}Consultando`;
    try {
      const r = await llamar('consultarDocumento', { numero: dni });
      if (r.yaCliente && r.yaCliente !== id) aviso(`Ese documento ya es del cliente ${r.yaCliente} ${r.nombre}.`, 'error');
      else {
        $('#f_NOMBRES').value = r.nombre;
        if (r.direccion && !$('#f_DIRECCION').value) $('#f_DIRECCION').value = r.direccion;
        aviso('Nombre encontrado' + (r.restantes !== undefined ? ` · le quedan ${r.restantes} consultas este mes` : '') + '.');
      }
    } catch (e) {
      aviso(e.message, 'error');
      if (e.codigo !== 'AUTH') web();
    } finally {
      $('#btnDni').disabled = false; $('#btnDni').innerHTML = `${ic('buscar')}Consultar`;
    }
  };
  $('#btnMapa').onclick = async () => { const r = await elegirEnMapa($('#f_COORDENADAS').value); if (r) $('#f_COORDENADAS').value = r; };
  $('#gps').onclick = () => {
    if (!navigator.geolocation) return aviso('Este celular no permite ubicación.', 'error');
    navigator.geolocation.getCurrentPosition((p) => { $('#f_COORDENADAS').value = p.coords.latitude.toFixed(5) + ',' + p.coords.longitude.toFixed(5); },
      () => aviso('No se pudo obtener la ubicación.', 'error'), { enableHighAccuracy: true, timeout: 15000 });
  };

  // ---- guardar ----
  async function guardar() {
    const d = {};
    ['DNI_RUC', 'NOMBRES', 'TELEFONO', 'TELEFONO2', 'DIRECCION', 'REFERENCIA', 'ZONA', 'COORDENADAS', 'DIA_VENC', 'OBSERVACIONES']
      .concat(clavesOk ? CLAVES : []).forEach((k) => { d[k] = v(k); });
    for (const k of ['cliente', 'servicio']) { const e = editar && k === 'servicio' ? '' : validar(k); if (e) { ir(pasos.findIndex((p) => p[0] === k)); return aviso(e, 'error'); } }
    if (editar) {
      await encolar({ tipo: 'EDITAR_CLIENTE', idCliente: id, datos: d });
      aviso(navigator.onLine ? 'Cambios enviados.' : 'Cambios guardados: se enviarán al volver la señal.');
      location.hash = '#/cliente/' + id;
      return;
    }
    const s = servicio(), inst = gastos(), fe = $('#s_inicio').value || hoyISO();
    const ppp = $('#s_pppWrap').hidden ? '' : $('#s_pppoe').value;
    if (!(await confirmar(`${d.NOMBRES}\n${s.plan} · ${soles(s.tarifa)}/mes` + (s.catv ? `\n+ SERVICIO DE CATV · ${soles(s.catv.tarifa)}/mes` : '') +
      (ppp ? `\nPPPoE ${ppp}` : '') + `\nA cobrar al instalar: ${$('#cbTotal').textContent}`, { titulo: '¿Registrar cliente?', si: 'Registrar' }))) return;
    d.FECHA_ALTA = fe;
    const op = await encolar({ tipo: 'ALTA_CLIENTE', datos: { cliente: d, servicio: { plan: s.plan, tarifa: s.tarifa, modo: $('#s_modo').value,
      pppoe: ppp, fechaInicio: fe, montoInstalacion: r2(inst.reduce((t, g) => t + g.monto, 0)), instalacion: inst,
      // monto del primer mes cambiado a mano (si no, el servidor calcula el prorrateo como siempre)
      montoPrimerMes: manualPM.inet, catv: s.catv && Object.assign({}, s.catv, manualPM.catv !== undefined ? { montoPrimerMes: manualPM.catv } : {}) } } });
    const irCobrar = $('#cbCobrar').checked;
    if (!navigator.onLine || !irCobrar) {
      aviso(navigator.onLine ? 'Cliente enviado. Aparecerá en la búsqueda en unos segundos.' : 'Guardado sin señal: se registrará al volver la conexión.');
      location.hash = '#/cola';
      return;
    }
    // con señal: esperar el código del cliente nuevo y abrir Cobrar
    vista().innerHTML = `<p class="aviso">${ic('sync', 'girando')}<span>Registrando al cliente…</span></p>`;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const o = (await colaTodos()).find((x) => x.idSolicitud === op.idSolicitud);
      const r = (o && o.resultado) || {}, idNuevo = (r.datos && r.datos.idCliente) || ((/Cliente (CLI-\d+)/.exec(r.mensaje || '') || [])[1]);
      if (o && o.estadoLocal === 'rechazado') { aviso('El alta fue rechazada: revise la cola.', 'error'); location.hash = '#/cola'; return; }
      if (idNuevo && D.porId[idNuevo]) { aviso('Cliente ' + idNuevo + ' registrado.'); location.hash = '#/cobrar/' + idNuevo; return; }
    }
    aviso('El alta sigue en la cola: cobre desde la ficha cuando aparezca.');
    location.hash = '#/cola';
  }
  ir(0);
}

// ---- PPPoE ---------------------------------------------------------------------------
function vPPPoE() {
  let filtro = 'Todos';
  // historial agrupado por código (búsqueda instantánea y sin consultar al servidor); se rehace al recibir datos
  let hist = histPorCodigo();
  const cuenta = (e) => D.pppoe.filter((p) => p.ESTADO === e).length;
  vista().innerHTML = `<h2 class="tit-ic">${ic('router')}PPPoE ${ayuda('PPPoE', 'Inventario de usuarios de internet (PPPoE) del router.\nDisponible: libre para un cliente nuevo. Asignado: lo usa un cliente. Bloqueado: no se debe usar.\nLo que usted cambia se ve al instante en este celular (con la marca "por enviar" mientras no llegue al servidor).\nAl abrir esta pantalla se piden los cambios de los otros técnicos.')}</h2>
    <input id="ppq" class="buscador" type="search" placeholder="Código PPPoE, cliente o titular" autocomplete="off" inputmode="search" aria-label="Buscar PPPoE">
    <div class="acciones-sel" id="ppFiltros"></div>
    <button class="btn" id="agregar">${ic('agregar')}Agregar código</button>
    <p class="sub" id="ppTotal"></p>
    <ul class="lista" id="ppLista"></ul>`;
  const fila = (p) => {
    const cli = p.ID_CLIENTE ? D.porId[p.ID_CLIENTE] || {} : null, res = p.ID_CLIENTE ? D.resumen[p.ID_CLIENTE] || {} : {};
    const anteriores = (hist[p.CODIGO] || []).filter((h) => h.F_HASTA || h.ID_CLIENTE !== p.ID_CLIENTE);
    return `<li><div class="pp"><div><b>${esc(p.CODIGO)}</b><small>Titular: ${esc(p.TITULAR || '-')}</small>
      ${cli ? `<small>Cliente: <a href="#/cliente/${esc(p.ID_CLIENTE)}">${esc(p.ID_CLIENTE)} · ${esc(p.CLIENTE)}</a>${cli.ZONA ? ' · ' + esc(cli.ZONA) : ''}${res.ESTADO ? ` <span class="chip ${claseEstado(res.ESTADO)}">${esc(res.ESTADO)}</span>` : ''}</small>` : ''}
      ${anteriores.length ? `<details class="hist"><summary>Usado antes por ${anteriores.length} cliente(s)</summary><ul>${anteriores.map((h) =>
        `<li><a href="#/cliente/${esc(h.ID_CLIENTE)}">${esc(h.ID_CLIENTE)} · ${esc(h.CLIENTE)}</a><small>${esc(txtFecha(h.F_DESDE)) || '¿?'} → ${esc(txtFecha(h.F_HASTA)) || 'hoy'}${h.MOTIVO_FIN ? ' · ' + esc(h.MOTIVO_FIN) : ''}</small></li>`).join('')}</ul></details>` : ''}</div>
      <div class="der"><span class="chip ${chipPPPoE(p.ESTADO)}">${esc(p.ESTADO)}</span>${marcaPend(p)}
      <button class="mini" data-editar="${esc(p.CODIGO)}">Editar</button>
      ${p.ESTADO === 'Asignado' ? `<button class="mini" data-acc="LIBERAR_PPPOE" data-c="${esc(p.CODIGO)}">Liberar</button>` : ''}
      ${p.ESTADO === 'Disponible' ? `<button class="mini verde" data-asignar="${esc(p.CODIGO)}">Asignar</button>` : ''}
      ${p.ESTADO === 'Disponible' ? `<button class="mini" data-acc="BLOQUEAR_PPPOE" data-c="${esc(p.CODIGO)}">Bloquear</button>` : ''}
      ${p.ESTADO === 'Bloqueado' ? `<button class="mini" data-acc="DESBLOQUEAR_PPPOE" data-c="${esc(p.CODIGO)}">Desbloquear</button>` : ''}</div></div></li>`;
  };
  const MAX = 50;
  const pintar = () => {
    hist = histPorCodigo();
    $('#ppFiltros').innerHTML = ['Todos', 'Disponible', 'Asignado', 'Bloqueado'].map((e) =>
      `<button class="mini ${e === filtro ? 'sel' : ''}" data-f="${e}">${e}${e === 'Todos' ? '' : ' (' + cuenta(e) + ')'}</button>`).join('');
    const q = $('#ppq').value.trim().toLowerCase();
    const coincide = (p) => coincidePPPoE(p, q, hist);
    const lista = D.pppoe.filter((p) => (filtro === 'Todos' || p.ESTADO === filtro) && coincide(p))
      .sort((x, y) => (q && String(y.CODIGO).toLowerCase() === q) - (q && String(x.CODIGO).toLowerCase() === q));   // el código exacto primero
    $('#ppTotal').textContent = lista.length > MAX ? `${lista.length} códigos · mostrando ${MAX}. Escriba más para afinar.` : `${lista.length} código(s)`;
    $('#ppLista').innerHTML = lista.slice(0, MAX).map(fila).join('') || '<li class="vacio">Sin códigos</li>';
    $('#ppFiltros').querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; pintar(); }; });
    $('#ppLista').querySelectorAll('[data-asignar]').forEach((b) => { b.onclick = () => asignarDesdePPPoE(b.dataset.asignar, pintar); });
    $('#ppLista').querySelectorAll('[data-editar]').forEach((b) => { b.onclick = async () => {
      const p = D.pppoe.find((x) => String(x.CODIGO) === b.dataset.editar) || {};
      const t = await pedirTexto('Titular de la cuenta (a nombre de quién está):', { titulo: `Editar PPPoE ${b.dataset.editar}`, valor: p.TITULAR || '', si: 'Guardar' });
      if (t === null) return;
      if (t.trim().length < 3) return aviso('Escriba el titular.', 'error');
      await encolar({ tipo: 'EDITAR_PPPOE', codigoPPPoE: b.dataset.editar, datos: { titular: t.trim() } });
      aviso(navigator.onLine ? 'Guardado.' : 'Guardado: se enviará al volver la señal.');
      pintar();
    }; });
    $('#ppLista').querySelectorAll('[data-acc]').forEach((b) => { b.onclick = async () => {
      const acc = b.dataset.acc, cod = b.dataset.c;
      const texto = { LIBERAR_PPPOE: 'liberar (queda Disponible)', BLOQUEAR_PPPOE: 'bloquear', DESBLOQUEAR_PPPOE: 'desbloquear' }[acc];
      const r = await pedirTexto(`Motivo para ${texto}:`, { titulo: `Código ${cod}`, si: 'Enviar' });
      if (r === null) return;
      const motivo = r.trim();
      if (!motivo && acc !== 'DESBLOQUEAR_PPPOE') return;
      await encolar({ tipo: acc, codigoPPPoE: cod, motivo: motivo || 'Desbloqueo' });
      aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
      pintar();
    }; });
  };
  $('#ppq').addEventListener('input', pintar);
  $('#agregar').onclick = async () => {
    const cod = ((await pedirTexto('Código PPPoE nuevo:', { titulo: 'Agregar código', si: 'Siguiente' })) || '').trim();
    if (!cod) return;
    if (D.pppoe.some((p) => String(p.CODIGO) === cod)) return aviso('Ese código ya existe.', 'error');
    const titular = await pedirTexto('Titular de la cuenta (a nombre de quién está):', { titulo: `Código ${cod}`, si: 'Agregar' });
    if (titular === null) return;
    await encolar({ tipo: 'AGREGAR_PPPOE', codigoPPPoE: cod, datos: { titular: titular.trim() } });
    aviso(navigator.onLine ? 'Código enviado.' : 'Guardado: se enviará al volver la señal.');
    pintar();
  };
  pintar();
  REPINTAR = pintar;                         // tras sincronizar: lista al día sin perder buscador ni filtro
  if (navigator.onLine) sincronizarParcial();  // pide al momento lo que cambiaron los otros técnicos
}

// ---- CAMBIO DE PLAN CON PRORRATEO ----------------------------------------------------------
// Mes del cambio: la cuota queda con el precio actual y la diferencia por días va como cargo aparte "AJUSTE PLAN"
// (monto sugerido, se puede modificar a mano). Desde el mes siguiente: tarifa nueva.
function vCambiarPlan(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  if (s.ESTADO !== 'Activo') { vista().innerHTML = '<p class="aviso error">Solo se cambia el plan de un servicio Activo.</p>'; return; }
  const actual = Number(s.TARIFA) || 0;
  const planes = D.planes.filter((p) => p.ACTIVO !== 'No' && p.PLAN !== s.PLAN);
  vista().innerHTML = `<section class="form"><h2>Cambiar plan</h2>
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)}</p>
    <dl><dt>Plan actual</dt><dd>${esc(s.PLAN)}</dd><dt>Tarifa actual</dt><dd>${soles(actual)}/mes</dd></dl>
    ${(() => { const duo = serviciosDuo(s.ID_CLIENTE); const otro = duo && duo.todos.some((x) => x.ID_SERV === s.ID_SERV) ? duo.todos.filter((x) => x.ID_SERV !== s.ID_SERV) : [];
      return otro.length ? `<p class="aviso">${ic('alerta')}<span>Este servicio es parte del <b>paquete DUO</b>. El cambio solo afecta a ${esc(nombreServicio(s.PLAN))}; ${otro.map((x) => esc(nombreServicio(x.PLAN)) + ' sigue en ' + soles(x.TARIFA)).join(', ')}. Para dejar solo un servicio use <b>Cortar → Baja</b> en el que se quita.</span></p>` : ''; })()}
    <label>Plan nuevo *<select id="pl"><option value="">— elegir —</option>${planes.map((p) => `<option data-t="${Number(p.TARIFA)}">${esc(p.PLAN)}</option>`).join('')}</select></label>
    <label>Tarifa nueva (S/ al mes)<input id="tar" type="number" step="0.10" inputmode="decimal"></label>
    <label>Fecha del cambio<input id="fec" type="date" value="${hoyISO()}"></label>
    <div id="calc"></div>
    <label class="check"><input type="checkbox" id="conOt" checked> Requiere visita técnica: generar <b>orden de trabajo</b> (el plan cambia cuando se marque como completada)</label>
    <label class="check"><input type="checkbox" id="manual"> Modificar el monto del ajuste manualmente</label>
    <div id="manualWrap" hidden><label>Monto del ajuste a cobrar (S/)<div class="fila"><input id="aj" type="number" step="0.10" inputmode="decimal">
      <button type="button" class="mini" id="redondear">Redondear</button></div></label>
      <p class="sub">Use 0 si no se cobra ajuste. Un monto negativo es un descuento en la cuota del mes.</p></div>
    <button class="btn grande verde" id="ok">${ic('check')}Registrar cambio de plan</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  let calc = null;
  const nueva = () => Number($('#tar').value || 0);
  const recalcular = () => {
    if (!$('#pl').value || !(nueva() > 0) || !$('#fec').value) { calc = null; $('#calc').innerHTML = ''; return; }
    calc = prorrateoPlan(actual, nueva(), $('#fec').value);
    const mesTxt = txtPeriodo($('#fec').value);
    $('#calc').innerHTML = `<div class="hero calculo">
      <span class="eyebrow">Mes del cambio · ${esc(mesTxt)} (${calc.diasMes} días)</span>
      <table class="periodos"><tbody>
        <tr><td>${calc.transcurridos} día(s) con el plan actual</td><td>${soles(calc.conActual)}</td></tr>
        <tr><td>${calc.restantes} día(s) con el plan nuevo</td><td>${soles(calc.conNueva)}</td></tr>
        <tr><td><b>Monto del mes sugerido</b></td><td><b>${soles(calc.montoMes)}</b></td></tr>
        <tr><td>Cuota del mes (ya generada)</td><td>${soles(actual)}</td></tr></tbody></table>
      <div class="totalr">${calc.ajuste >= 0 ? 'Ajuste a cobrar' : 'Descuento'} <b>${soles(Math.abs(calc.ajuste))}</b></div>
      <p class="sub">${calc.ajuste >= 0 ? 'Se agrega como cargo aparte "AJUSTE PLAN" en ' + esc(mesTxt) + '.' : 'Se descuenta de lo que falte pagar de la cuota de ' + esc(mesTxt) + '.'}
        Desde el mes siguiente la cuota será ${soles(nueva())}.</p></div>`;
    if (!$('#manual').checked) $('#aj').value = calc.ajuste.toFixed(2);
  };
  $('#pl').onchange = (e) => { const o = e.target.selectedOptions[0]; $('#tar').value = o && o.dataset.t ? o.dataset.t : ''; recalcular(); };
  $('#tar').oninput = recalcular;
  $('#fec').onchange = recalcular;
  $('#manual').onchange = () => { $('#manualWrap').hidden = !$('#manual').checked; if (!$('#manual').checked) recalcular(); else $('#aj').focus(); };
  $('#redondear').onclick = () => { const v = Number($('#aj').value || 0); $('#aj').value = (v >= 0 ? Math.round(v) : -Math.round(-v)).toFixed(2); };
  $('#ok').onclick = async () => {
    if (!$('#pl').value) return aviso('Elija el plan nuevo.', 'error');
    if (!(nueva() > 0)) return aviso('La tarifa debe ser mayor a 0.', 'error');
    if (!calc) return aviso('Revise la fecha del cambio.', 'error');
    const manual = $('#manual').checked, ajuste = manual ? Number($('#aj').value) : calc.ajuste;
    if (manual && ($('#aj').value === '' || isNaN(ajuste))) return aviso('Escriba el monto del ajuste (0 si no se cobra).', 'error');
    const texto = `${s.PLAN} ${soles(actual)} → ${$('#pl').value} ${soles(nueva())}\nDesde el ${txtFecha($('#fec').value)}\n` +
      (ajuste > 0 ? `Cargo aparte AJUSTE PLAN: ${soles(ajuste)}` : ajuste < 0 ? `Descuento en la cuota del mes: ${soles(-ajuste)}` : 'Sin ajuste en el mes del cambio') +
      (manual && r2(ajuste) !== calc.ajuste ? `\n(sugerido ${soles(calc.ajuste)})` : '');
    if ($('#conOt').checked) {
      if (!(await confirmar(texto.split('\n')[0] + '\nQueda PENDIENTE DE INSTALACIÓN. El cambio y el prorrateo se aplican con la fecha en que se marque completada.' +
        (manual ? `\nAjuste fijado a mano: ${soles(ajuste)}` : ''), { titulo: '¿Generar orden de trabajo?', si: 'Generar orden' }))) return;
      const op = { tipo: 'CREAR_ORDEN', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, plan: $('#pl').value, tarifa: nueva(),
        datos: manual ? { tipo: 'CAMBIO_PLAN', ajuste: r2(ajuste) } : { tipo: 'CAMBIO_PLAN' },
        vista: { tipo: 'CAMBIO_PLAN', datos: { planAnt: s.PLAN, tarifaAnt: actual, plan: $('#pl').value, tarifa: nueva(), ajuste: manual ? r2(ajuste) : undefined },
          items: [{ idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, snap: snapshotLocal(s.ID_CLIENTE, s.ID_SERV) }] } };
      await encolar(op);
      aviso(navigator.onLine ? 'Orden de trabajo enviada.' : 'Orden guardada sin señal: ya puede imprimirla.');
      location.hash = '#/orden/' + op.idSolicitud;
      return;
    }
    if (!(await confirmar(texto, { titulo: '¿Registrar el cambio de plan?', si: 'Registrar' }))) return;
    await encolar({ tipo: 'CAMBIAR_PLAN', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, plan: $('#pl').value, tarifa: nueva(),
      fecha: $('#fec').value, datos: manual ? { prorrateo: true, ajuste: r2(ajuste) } : { prorrateo: true } });
    aviso(navigator.onLine ? 'Cambio de plan enviado.' : 'Guardado sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

// ---- ORDEN DE SERVICIO (visita técnica; datos editables antes de imprimir) ---------------------
const OS_TRABAJOS = ['Instalación', 'Visita técnica / revisión', 'Sin señal / falla', 'Traslado', 'Cambio de equipo', 'Retiro de equipo', 'Otro'];

function vOrdenServicio(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  const sn = snapshotLocal(s.ID_CLIENTE, s.ID_SERV), r = D.resumen[s.ID_CLIENTE] || {};
  const campo = (k, etq, extra = '') => `<label>${etq}<input id="os_${k}" value="${esc(sn[k] || '')}" ${extra}></label>`;
  vista().innerHTML = `<section class="form"><h2>Orden de servicio</h2>
    <p class="sub">${esc(s.ID_CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(nombreServicio(s.PLAN))}</p>
    <h3>Trabajo</h3>
    <label>Tipo de trabajo *<select id="os_trabajo">${OS_TRABAJOS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
    <label>Descripción / motivo<textarea id="os_motivo" rows="3" placeholder="Ej.: sin señal desde ayer, revisar ONU"></textarea></label>
    <div class="dos"><label>Fecha<input id="os_fecha" type="date" value="${hoyISO()}"></label><label>Hora<input id="os_hora" type="time"></label></div>
    <label>Técnico<input id="os_tecnico" placeholder="Nombre del técnico"></label>
    <label>Cobrar en la visita (S/, opcional)<input id="os_cobrar" type="number" step="0.10" inputmode="decimal" placeholder="${Number(r.DEUDA_VENCIDA) > 0 ? 'Debe ' + r2(r.DEUDA_VENCIDA).toFixed(2) : '0.00'}"></label>
    <h3>Datos del cliente <small class="sub">(corrija lo que haga falta; no cambia la ficha)</small></h3>
    ${campo('n', 'Nombre')}${campo('doc', 'DNI / RUC', 'inputmode="numeric"')}
    <div class="dos">${campo('tel', 'Celular', 'inputmode="numeric"')}${campo('tel2', 'Celular 2', 'inputmode="numeric"')}</div>
    ${campo('dir', 'Dirección')}${campo('ref', 'Referencia')}
    <div class="dos">${campo('zona', 'Zona')}${campo('gps', 'Coordenadas')}</div>
    <div class="dos">${campo('plan', 'Plan')}${campo('pppoe', 'PPPoE')}</div>
    ${campo('modo', 'Equipo / modo')}
    <label>Observaciones<textarea id="os_obs" rows="2"></textarea></label>
    <button class="btn grande verde" id="ok">${ic('documento')}Generar orden</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  $('#ok').onclick = async () => {
    const v = (k) => $('#os_' + k).value.trim();
    const servicio = { trabajo: v('trabajo'), motivo: v('motivo'), tecnico: v('tecnico'), fecha: v('fecha'), hora: v('hora'), obs: v('obs') };
    if (v('cobrar')) servicio.cobrar = r2(Number(v('cobrar')));
    if (servicio.cobrar !== undefined && !(servicio.cobrar >= 0)) return aviso('Monto a cobrar inválido.', 'error');
    const editado = {};
    ['n', 'doc', 'tel', 'tel2', 'dir', 'ref', 'zona', 'gps', 'plan', 'pppoe', 'modo'].forEach((k) => { if (v(k) !== String(sn[k] || '')) editado[k] = v(k); });
    if (!(await confirmar(`${v('n')}\n${servicio.trabajo}${servicio.motivo ? ': ' + servicio.motivo : ''}\n${txtFecha(servicio.fecha)}${servicio.hora ? ' ' + servicio.hora : ''}` +
      (Object.keys(editado).length ? `\nDatos corregidos en la orden: ${Object.keys(editado).length}` : ''), { titulo: '¿Generar orden de servicio?', si: 'Generar' }))) return;
    const items = [{ idServ: s.ID_SERV, idCliente: s.ID_CLIENTE }];
    const op = { tipo: 'CREAR_ORDEN', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, datos: { tipo: 'ORDEN_SERVICIO', items, servicio, editado },
      vista: { tipo: 'ORDEN_SERVICIO', datos: servicio, items: [{ idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, snap: Object.assign({}, sn, editado) }] } };
    await encolar(op);
    aviso(navigator.onLine ? 'Orden enviada.' : 'Orden guardada sin señal: ya puede imprimirla.');
    location.hash = '#/orden/' + op.idSolicitud;
  };
}

// ---- ESTADO DE CUENTA DEL CLIENTE (matriz mes × servicio) -----------------------------------
// El historial completo se pide al servidor al abrir la ficha (acción de lectura estadoCuenta) y se guarda
// en el celular (cuenta_<id>) para verlo sin señal. Sin señal y sin copia: solo lo pendiente.
const MES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
/** Comentarios que contradicen un "Pagado" (el patrón de Livia: "debe de CATV", "solo pagó internet"). */
const OBS_REVISAR = /\b(debe|s[oó]lo|falta|pendiente|no\s+pag)/i;
const MARCAS = { AJUSTE: 'Ajuste', 'ANULADO-AJUSTE': 'Anulado por ajuste', CONVENIO: 'Convenio', CASTIGADO: 'Castigado' };
const marcaCargo = (obs) => { const m = /^\[(AJUSTE|ANULADO-AJUSTE|CONVENIO|CASTIGADO)/.exec(String(obs || '')); return m ? MARCAS[m[1]] : ''; };
const aObj = (t) => (t && t.filas ? t.filas.map((f) => Object.fromEntries(t.cols.map((c, i) => [c, f[i]]))) : []);
/** Comentario del cobro sin el texto automático de la migración (que se repite en todos los recibos MIG-). */
const comentarioPago = (o) => String(o || '').replace(/^Pago migrado de CONTROL 2026[^|]*\|?\s*/, '').trim();
const montoCorto = (x) => { const n = r2(Number(x) || 0); return Number.isInteger(n) ? String(n) : n.toFixed(2); };

async function cargarCuenta(id) {
  const guardado = await kvGet('cuenta_' + id);
  if (navigator.onLine) {
    try {
      const r = await llamar('estadoCuenta', { idCliente: id });
      const o = { cargos: aObj(r.cargos), det: aObj(r.det), pagos: aObj(r.pagos), generado: r.generado };
      await kvSet('cuenta_' + id, o);
      return Object.assign(o, { origen: 'servidor' });
    } catch (e) { /* sin servidor: se usa lo guardado */ }
  }
  if (guardado) return Object.assign(guardado, { origen: 'guardado' });
  return { cargos: D.cargos.filter((k) => k.ID_CLIENTE === id), det: [], pagos: D.pagos.filter((p) => p.ID_CLIENTE === id), origen: 'local' };
}

/** Dibuja la tarjeta "Estado de cuenta" dentro de cont. anio: el año a mostrar (por defecto, el actual). */
function pintarCuenta(cont, id, cu, anio) {
  if (!cont || !cont.isConnected) return;
  const anios = [...new Set(cu.cargos.map((k) => String(k.PERIODO).slice(0, 4)).filter((a) => /^\d{4}$/.test(a)))].sort();
  const hoyA = hoyISO().slice(0, 4);
  anio = anio || (anios.includes(hoyA) ? hoyA : anios[anios.length - 1] || hoyA);
  const delAnio = cu.cargos.filter((k) => String(k.PERIODO).startsWith(anio));
  // columnas: un servicio por columna (mensualidades), INTERNET primero; lo demás va en "Otros"
  const servs = {};
  delAnio.filter((k) => k.CONCEPTO === 'MENSUALIDAD').forEach((k) => {
    const s = servicioPorId(k.ID_SERV);
    servs[k.ID_SERV] = servs[k.ID_SERV] || nombreCorto({ CONCEPTO: 'MENSUALIDAD', PLAN: (s && s.PLAN) || k.PLAN });
  });
  const cols = Object.keys(servs).sort((a, b) => (/INTERNET/i.test(servs[a]) ? 0 : 1) - (/INTERNET/i.test(servs[b]) ? 0 : 1) || a.localeCompare(b));
  const otros = delAnio.filter((k) => k.CONCEPTO !== 'MENSUALIDAD');
  const celda = (ks) => {
    if (!ks.length) return '<td class="vacia">·</td>';
    const vivos = ks.filter((k) => k.ANULADO !== 'Sí');
    const ids = ks.map((k) => k.ID_CARGO).join(',');
    const conObs = ks.some((k) => String(k.OBS || '').trim());
    if (!vivos.length) return `<td><button class="celda anulada" data-cargos="${esc(ids)}">—<small>${esc(marcaCargo(ks[0].OBS) || 'Anulado')}</small></button></td>`;
    const monto = vivos.reduce((t, k) => t + Number(k.MONTO || 0), 0);
    const peor = ['Vencido', 'Parcial', 'Por vencer', 'Pendiente', 'Pagado'].find((e) => vivos.some((k) => k.ESTADO === e)) || vivos[0].ESTADO;
    return `<td><button class="celda ${claseEstado(peor)}" data-cargos="${esc(ids)}" aria-label="${esc(peor)} ${soles(monto)}">${montoCorto(monto)}${conObs ? '<i aria-hidden="true">•</i>' : ''}</button></td>`;
  };
  const filasM = MES_CORTO.map((m, i) => {
    const mm = anio + '-' + String(i + 1).padStart(2, '0');
    const enMes = (k) => String(k.PERIODO).startsWith(mm);
    return `<tr><th scope="row">${m}</th>${cols.map((s) => celda(delAnio.filter((k) => k.ID_SERV === s && k.CONCEPTO === 'MENSUALIDAD' && enMes(k)))).join('')}
      ${otros.length ? celda(otros.filter(enMes)) : ''}</tr>`;
  }).join('');
  const vivosA = delAnio.filter((k) => k.ANULADO !== 'Sí');
  const fact = vivosA.reduce((t, k) => t + Number(k.MONTO || 0), 0), falta = vivosA.reduce((t, k) => t + Number(k.SALDO || 0), 0);
  const revisar = cu.cargos.filter((k) => k.ANULADO !== 'Sí' && Number(k.SALDO) <= 0.004 && OBS_REVISAR.test(String(k.OBS || '')))
    .sort((a, b) => String(b.PERIODO).localeCompare(String(a.PERIODO)));
  const nota = { servidor: '', guardado: `Sin conexión: datos guardados del ${txtFecha(cu.generado)}.`,
    local: 'Sin conexión: solo se ven los meses pendientes. Conéctese para ver lo pagado.' }[cu.origen];
  cont.innerHTML = `<div class="ec-cab"><h3 class="tit-ic">Estado de cuenta ${ayuda('Cómo leer el estado de cuenta', 'Cada fila es un mes y cada columna un servicio.\nVerde: pagado · Ámbar: pagado en parte o por vencer · Rojo: vencido · Gris: pendiente.\nEl punto (•) indica que el mes tiene una nota. Toque un mes para ver sus pagos y la nota.')}</h3></div>
    ${anios.length > 1 ? `<div class="ec-anios" role="group" aria-label="Año">${anios.map((a) => `<button class="mini ${a === anio ? 'sel' : ''}" data-anio="${a}" aria-pressed="${a === anio}">${a}</button>`).join('')}</div>` : ''}
    ${nota ? `<p class="aviso">${ic('info')}<span>${esc(nota)}</span></p>` : ''}
    <div class="ec-cifras"><div><span>Total ${esc(anio)}</span><b>${soles(fact)}</b></div><div class="ok"><span>Pagado</span><b>${soles(fact - falta)}</b></div>
      <div class="${falta > 0.004 ? 'peligro' : 'ok'}"><span>Falta</span><b>${soles(falta)}</b></div></div>
    ${cols.length || otros.length ? `<table class="matriz"><thead><tr><th>Mes</th>${cols.map((s) => `<th>${esc(servs[s])}</th>`).join('')}${otros.length ? '<th>Otros</th>' : ''}</tr></thead>
      <tbody>${filasM}</tbody></table>
    <p class="ec-leyenda"><span><i class="punto e-activo"></i>Pagado</span><span><i class="punto e-porvencer"></i>Parcial</span><span><i class="punto e-moroso"></i>Vencido</span><span><i class="punto e-pend"></i>Pendiente</span><span>• nota</span></p>`: `<p class="vacio">Sin cargos en ${esc(anio)}.</p>`}
    ${revisar.length ? `<details class="ec-revisar aviso-caja"><summary>${ic('alerta')}Para revisar (${revisar.length}) ${ayuda('Para revisar', 'Meses que figuran como pagados pero cuya nota dice otra cosa (ej.: "debe CATV", "solo pagó internet").\nRevíselos y, si corresponde, corrija con Ajustar.')}</summary>
      <ul class="lista compacta">${revisar.slice(0, 20).map((k) => `<li><button class="enlace" data-cargos="${esc(k.ID_CARGO)}">
        <b>${esc(txtPeriodo(k.PERIODO))} · ${esc(nombreCorto(k))}</b><small>${esc(String(k.OBS).slice(0, 90))}</small></button></li>`).join('')}</ul></details>` : ''}`;
  cont.querySelectorAll('[data-anio]').forEach((b) => { b.onclick = () => pintarCuenta(cont, id, cu, b.dataset.anio); });
  cont.querySelectorAll('[data-cargos]').forEach((b) => { b.onclick = () => detalleMes(cu, b.dataset.cargos.split(',')); });
}

/** Ventana con lo importante de un mes: monto, pagos (recibo, fecha, método, comentario) y la nota del cargo. */
function detalleMes(cu, ids) {
  const ks = ids.map((i) => cu.cargos.find((k) => k.ID_CARGO === i)).filter(Boolean);
  if (!ks.length) return;
  const bloque = (k) => {
    const pagos = cu.det.filter((d) => d.ID_CARGO === k.ID_CARGO);
    const marca = marcaCargo(k.OBS), anul = k.ANULADO === 'Sí';
    const est = anul ? 'e-pend' : claseEstado(k.ESTADO);
    return `<div class="ec-mes"><div class="ec-mes-cab ${est}"><b>${esc(txtPeriodo(k.PERIODO))}</b><span>${esc(nombreCorto(k))}</span>
        <span class="chip ${est}">${esc(anul ? 'Anulado' : k.ESTADO)}</span></div>
      ${marca ? `<p class="sub">${ic('ajustes')}${esc(marca)}</p>` : ''}
      <div class="ec-cifras chica"><div><span>Monto</span><b>${soles(k.MONTO)}</b></div>${anul ? '' : `<div class="ok"><span>Pagado</span><b>${soles(k.PAGADO)}</b></div>
        <div class="${Number(k.SALDO) > 0.004 ? 'peligro' : 'ok'}"><span>Falta</span><b>${soles(k.SALDO)}</b></div>`}</div>
      ${anul ? '' : `<p class="sub">${ic('reloj')}Vence ${esc(txtFecha(k.VENCE))}${Number(k.DIAS_ATRASO) > 0 ? ' · <b>' + esc(txtMora(k.DIAS_ATRASO)) + ' de atraso</b>' : ''}</p>`}
      ${String(k.OBS || '').trim() ? `<div class="nota-caja">${ic('chat')}<span>${esc(k.OBS)}</span></div>` : ''}
      ${pagos.length ? `<ul class="lista pagos">${pagos.map((d) => { const p = cu.pagos.find((x) => x.N_RECIBO === d.N_RECIBO) || {};
        return `<li><a href="#/pago/${encodeURIComponent(d.N_RECIBO)}">${icoMetodo(d.METODO)}<div><b>Pagado el ${esc(txtFecha(d.FECHA_PAGO))}</b><small>${esc(d.N_RECIBO)} · ${esc(d.METODO)}</small>
          ${comentarioPago(p.OBS) ? `<small class="coment">“${esc(comentarioPago(p.OBS))}”</small>` : ''}</div><div class="der"><b class="monto">${soles(d.MONTO_APLICADO)}</b></div></a></li>`; }).join('')}</ul>`
        : anul ? '' : '<p class="vacio">Sin pagos en este mes.</p>'}</div>`;
  };
  const m = modal(`<h3 id="dlgT">Detalle del mes</h3>${ks.map(bloque).join('')}<button class="btn secundario" id="ecCerrar">Cerrar</button>`);
  prepararDialogo(m, () => {});
  m.querySelector('#ecCerrar').onclick = cerrarModal;
  m.querySelectorAll('a[href^="#/pago/"]').forEach((a) => { a.addEventListener('click', cerrarModal); });
}

// ---- AJUSTE DE CUENTA (descuento, perdón, anulación, cambio de monto) -----------------------
// Lo ya pagado no se toca; el servidor (Ajustes.gs) vuelve a validar todo y deja el registro en la tabla Ajustes.
const AJ_NOMBRE = { DESCUENTO: 'Descuento', PERDON: 'Perdonado', ANULACION: 'Anulado', CAMBIO_MONTO: 'Cambio de precio' };
const AJ_MOTIVOS = ['Falla del servicio', 'Descuento comercial', 'Cortesía', 'Error de cobro / precio', 'Acuerdo con el cliente', 'Otro'];

/** Igual que op_ajustarCargos: monto nuevo y si queda anulado, o el error que daría el servidor. */
function calcularAjuste(k, tipo, valor) {
  const monto = r2(Number(k.MONTO) || 0), pag = r2(Number(k.PAGADO) || 0), saldo = r2(Math.max(0, monto - pag));
  const mes = txtPeriodo(k.PERIODO);
  if (tipo === 'DESC_S' || tipo === 'DESC_P') {
    const d = tipo === 'DESC_P' ? r2(saldo * valor / 100) : r2(valor);
    if (tipo === 'DESC_P' && valor > 100) return { error: 'El porcentaje no puede pasar de 100.' };
    if (!(d > 0)) return { error: 'Escriba el descuento.' };
    if (d > saldo + 0.004) return { error: `${mes}: el descuento (${soles(d)}) es mayor que lo que falta pagar (${soles(saldo)}).` };
    const nuevo = r2(monto - d);
    return { nuevo, anular: nuevo <= 0.004 && pag <= 0.004 };
  }
  if (tipo === 'PERDON') return { nuevo: pag, anular: pag <= 0.004 };
  if (tipo === 'ANULACION') return pag > 0.004 ? { error: `${mes} tiene pagos (${soles(pag)}): anule primero el recibo o use "Perdonar".` } : { nuevo: 0, anular: true };
  if (!(valor >= 0) || isNaN(valor)) return { error: 'Escriba el monto nuevo.' };
  if (valor < pag - 0.004) return { error: `${mes}: el monto nuevo es menor que lo ya pagado (${soles(pag)}).` };
  if (Math.abs(valor - monto) < 0.005) return { error: `${mes} ya vale ${soles(monto)}.` };
  return { nuevo: r2(valor), anular: valor <= 0.004 && pag <= 0.004 };
}

/**
 * Lista de meses con los mismos filtros que Cobrar: Vencidos / Todo / Ninguno, "Adelantar meses" (los futuros
 * se ocultan) y, si un mes tiene INTERNET + CATV, una sola fila por mes con "Ver por servicio".
 * marcar: 'vencidos' | 'ninguno'. Devuelve { elegidos(), total() } (solo cargos visibles y marcados).
 */
function listaMeses(cont, cargos, { marcar = 'ninguno', alCambiar = () => {} } = {}) {
  const hoyMes = hoyISO().slice(0, 7);
  const vencido = (k) => Number(k.DIAS_ATRASO) > 0 || k.ESTADO === 'Vencido';
  const fila = (k, marcado, hijo) => `<label class="cargo ${hijo ? 'hijo' : ''}">
      <input type="checkbox" value="${esc(k.ID_CARGO)}" data-saldo="${Number(k.SALDO)}" ${marcado ? 'checked' : ''}>
      <span class="per">${hijo ? esc(nombreCorto(k)) : esc(txtPeriodo(k.PERIODO))}</span>
      <span class="det">${hijo ? esc(txtPeriodo(k.PERIODO)) : esc(nombreCargo(k))}${Number(k.PAGADO) > 0 ? ' · pagado ' + soles(k.PAGADO) : ''}</span>
      <span class="chip ${claseEstado(k.ESTADO)}">${esc(k.ESTADO)}</span><b>${soles(k.SALDO)}</b></label>`;
  const meses = [];
  cargos.forEach((k) => { const ym = String(k.PERIODO).slice(0, 7), u = meses[meses.length - 1]; if (u && u.ym === ym) u.cargos.push(k); else meses.push({ ym, cargos: [k] }); });
  const grupo = (g) => {
    const futuro = g.ym > hoyMes, marcado = marcar === 'vencidos' && g.cargos.some(vencido);
    const attrs = `class="mes-grupo ${futuro ? 'futuro' : ''}" ${futuro ? 'data-futuro="1"' : ''}`;
    if (g.cargos.length === 1) return `<div ${attrs}>${fila(g.cargos[0], marcado, false)}</div>`;
    const saldo = r2(g.cargos.reduce((s, k) => s + Number(k.SALDO), 0));
    return `<div ${attrs}><label class="cargo"><input type="checkbox" class="todo-mes" ${marcado ? 'checked' : ''} aria-label="Todo ${esc(txtPeriodo(g.ym))}">
        <span class="per">${esc(txtPeriodo(g.ym))}</span><span class="det">${g.cargos.map((k) => esc(nombreCorto(k)) + ' ' + soles(k.SALDO).slice(3)).join(' + ')}</span>
        <span class="chip ${claseEstado(g.cargos[0].ESTADO)}">${esc(g.cargos[0].ESTADO)}</span><b>${soles(saldo)}</b></label>
      <div class="hijos" hidden>${g.cargos.map((k) => fila(k, marcado, true)).join('')}</div></div>`;
  };
  const hayGrupos = meses.some((g) => g.cargos.length > 1), hayFut = meses.some((g) => g.ym > hoyMes);
  cont.innerHTML = `<div class="acciones-sel">
      <button type="button" class="mini" data-sel="v">Vencidos</button><button type="button" class="mini" data-sel="t">Todo</button>
      <button type="button" class="mini" data-sel="n">Ninguno</button>
      ${hayFut ? '<label class="mini check"><input type="checkbox" class="lmFut"> Meses futuros</label>' : ''}
      ${hayGrupos ? '<label class="mini check"><input type="checkbox" class="lmServ"> Ver por servicio</label>' : ''}</div>
    <div class="cargos">${meses.map(grupo).join('')}</div>
    <div class="total fijo">Seleccionado: <b class="lmTotal">S/ 0.00</b></div>`;
  const cajas = () => [...cont.querySelectorAll('input[data-saldo]')];
  const visibles = () => cajas().filter((x) => !x.closest('.mes-grupo').hidden);
  const sincronizar = () => cont.querySelectorAll('.todo-mes').forEach((m) => {
    const hs = [...m.closest('.mes-grupo').querySelectorAll('input[data-saldo]')], n = hs.filter((x) => x.checked).length;
    m.checked = n === hs.length; m.indeterminate = n > 0 && n < hs.length;
  });
  const total = () => r2(visibles().filter((x) => x.checked).reduce((s, x) => s + Number(x.dataset.saldo), 0));
  const elegidos = () => visibles().filter((x) => x.checked).map((x) => cargos.find((k) => k.ID_CARGO === x.value));
  const cambio = () => { sincronizar(); cont.querySelector('.lmTotal').textContent = soles(total()); alCambiar(); };
  cont.querySelectorAll('.mes-grupo[data-futuro]').forEach((g) => { g.hidden = true; g.querySelectorAll('input').forEach((x) => { x.checked = false; }); });
  cont.querySelector('.cargos').addEventListener('change', (e) => {
    if (e.target.classList.contains('todo-mes')) e.target.closest('.mes-grupo').querySelectorAll('input[data-saldo]').forEach((x) => { x.checked = e.target.checked; });
    cambio();
  });
  cont.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = () => {
    visibles().forEach((x) => { const k = cargos.find((c) => c.ID_CARGO === x.value); x.checked = b.dataset.sel === 't' || (b.dataset.sel === 'v' && vencido(k)); });
    cambio();
  }; });
  const fut = cont.querySelector('.lmFut');
  if (fut) fut.onchange = () => { cont.querySelectorAll('.mes-grupo[data-futuro]').forEach((g) => { g.hidden = !fut.checked; if (!fut.checked) g.querySelectorAll('input').forEach((x) => { x.checked = false; }); }); cambio(); };
  const ps = cont.querySelector('.lmServ');
  if (ps) ps.onchange = () => { cont.querySelectorAll('.hijos').forEach((h) => { h.hidden = !ps.checked; }); };
  cambio();
  return { elegidos, total };
}

// ---- AJUSTE DE CUENTA (descuento, perdón, anulación, cambio de precio) ----------------------
const AJ_TIPOS_UI = [
  { v: 'DESC_S', t: 'Descuento S/', icono: 'cobrar' }, { v: 'DESC_P', t: 'Descuento %', icono: 'grafico' },
  { v: 'PERDON', t: 'Perdonar', icono: 'check' }, { v: 'ANULACION', t: 'Anular', icono: 'anular' }, { v: 'CAMBIO', t: 'Cambio de precio', icono: 'editar' },
];
const AJ_AYUDA = 'Descuento S/: resta un monto fijo a cada mes marcado.\nEj.: mes de S/ 75 con S/ 10 → paga S/ 65.\n\n' +
  'Descuento %: resta un porcentaje de lo que falta pagar.\nEj.: falta S/ 50 y pone 20 % → paga S/ 40.\n\n' +
  'Perdonar: ya no paga lo que falta de esos meses. Lo pagado se queda.\nEj.: pagó S/ 30 de S/ 75 → el mes se cierra en S/ 30.\n\n' +
  'Anular: el mes sale de la deuda, como si no se hubiera cobrado. Solo si no tiene pagos.\nEj.: se cobró un mes en que no tuvo servicio.\n\n' +
  'Cambio de precio: el mes pasa a valer otro monto.\nEj.: se cobró S/ 75 por error y era S/ 50.\n\nTodo queda registrado con su motivo.';

function vAjustar(id) {
  const c = D.porId[id];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const cargos = cargosDe(id);
  const saldoTot = cargos.reduce((t, k) => t + Number(k.SALDO || 0), 0);
  vista().innerHTML = `<section class="form"><h2>Ajustar cuenta</h2>
    <p class="sub">${esc(c.NOMBRES)} · ${esc(id)} · debe ${soles(saldoTot)}</p>
    ${cargos.length ? `<h3>1. Meses</h3><div id="ajMeses"></div>
    <h3 class="tit-ic">2. Tipo de ajuste ${ayuda('¿Qué hace cada ajuste?', AJ_AYUDA)}</h3>
    <div class="tipos-aj" role="radiogroup" aria-label="Tipo de ajuste">${AJ_TIPOS_UI.map((x, i) => `<label><input type="radio" name="ajTipo" value="${x.v}" ${i ? '' : 'checked'}>${ic(x.icono)}${esc(x.t)}</label>`).join('')}</div>
    <label id="ajValWrap"><span id="ajValTxt">Descuento (S/)</span><input id="ajVal" type="number" step="0.10" inputmode="decimal"></label>
    <h3>3. Motivo</h3>
    <label><span class="sr">Motivo</span><select id="ajMot">${AJ_MOTIVOS.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
    <label id="ajDetWrap">Detalle<input id="ajDet" placeholder="Ej.: sin señal del 3 al 10 de octubre"></label>
    <div id="ajPrev"></div>
    <button class="btn grande verde" id="ok">${ic('check')}Registrar ajuste</button>` : '<p class="vacio">Este cliente no tiene montos pendientes que ajustar.</p>'}
    <a class="btn secundario" href="#/cliente/${esc(id)}">Cancelar</a></section>`;
  if (!cargos.length) return;
  const tipoTx = { DESC_S: 'Descuento por mes (S/)', DESC_P: 'Descuento (%)', CAMBIO: 'Precio nuevo del mes (S/)' };
  const tipoSel = () => vista().querySelector('input[name="ajTipo"]:checked').value;
  let plan = null, lm = null;
  const pintar = () => {
    if (!lm) return;
    const tipo = tipoSel(), valor = Number($('#ajVal').value);
    $('#ajValWrap').hidden = !tipoTx[tipo];
    $('#ajValTxt').textContent = tipoTx[tipo] || '';
    $('#ajDetWrap').querySelector('input').placeholder = $('#ajMot').value === 'Otro' ? 'Escriba el motivo (obligatorio)' : 'Opcional';
    const sel = lm.elegidos();
    plan = null;
    if (!sel.length) { $('#ajPrev').innerHTML = '<p class="sub">Marque uno o más meses.</p>'; return; }
    const filasP = sel.map((k) => ({ k, r: calcularAjuste(k, tipo, valor) }));
    const err = filasP.find((x) => x.r.error);
    if (err) { $('#ajPrev').innerHTML = `<p class="aviso error">${esc(err.r.error)}</p>`; return; }
    const antes = filasP.reduce((t, x) => t + Number(x.k.SALDO || 0), 0);
    const despues = filasP.reduce((t, x) => t + (x.r.anular ? 0 : Math.max(0, x.r.nuevo - Number(x.k.PAGADO || 0))), 0);
    plan = filasP;
    $('#ajPrev').innerHTML = `<div class="hero calculo"><span class="eyebrow">Así quedaría</span>
      <table class="periodos"><tbody>${filasP.map((x) => `<tr><td>${esc(txtPeriodo(x.k.PERIODO))} ${esc(nombreCorto(x.k))}</td>
        <td>${soles(x.k.MONTO)} → ${x.r.anular ? 'anulado' : soles(x.r.nuevo)}</td></tr>`).join('')}</tbody></table>
      <div class="totalr">Debe ${soles(antes)} → <b>${soles(despues)}</b></div></div>`;
  };
  lm = listaMeses($('#ajMeses'), cargos, { marcar: 'ninguno', alCambiar: pintar });
  vista().querySelectorAll('input[name="ajTipo"]').forEach((x) => { x.onchange = () => { $('#ajVal').value = ''; pintar(); }; });
  $('#ajVal').oninput = pintar;
  $('#ajMot').onchange = pintar;
  pintar();
  $('#ok').onclick = async () => {
    pintar();
    if (!plan) return aviso(lm.elegidos().length ? 'Revise el ajuste: hay un error.' : 'Marque al menos un mes.', 'error');
    const det = $('#ajDet').value.trim(), motivo = $('#ajMot').value + (det ? ': ' + det : '');
    if ($('#ajMot').value === 'Otro' && det.length < 5) return aviso('Escriba el detalle del motivo.', 'error');
    const tipo = tipoSel(), valor = Number($('#ajVal').value);
    const items = plan.map((x) => {
      const it = { idCargo: x.k.ID_CARGO };
      if (tipo === 'DESC_S') Object.assign(it, { tipo: 'DESCUENTO', monto: r2(valor) });
      else if (tipo === 'DESC_P') Object.assign(it, { tipo: 'DESCUENTO', porcentaje: r2(valor) });
      else if (tipo === 'CAMBIO') Object.assign(it, { tipo: 'CAMBIO_MONTO', monto: r2(valor) });
      else it.tipo = tipo;
      return it;
    });
    const resumen = plan.map((x) => `${txtPeriodo(x.k.PERIODO)} ${nombreCorto(x.k)}: ${soles(x.k.MONTO)} → ${x.r.anular ? 'anulado' : soles(x.r.nuevo)}`).join('\n');
    if (!(await confirmar(`${c.NOMBRES}\n${resumen}\nMotivo: ${motivo}`, { titulo: '¿Registrar el ajuste?', si: 'Registrar' }))) return;
    await encolar({ tipo: 'AJUSTAR_CARGOS', idCliente: id, motivo, datos: { items } });
    aviso(navigator.onLine ? 'Ajuste enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + id;
  };
}

// ---- CONVENIOS DE PAGO, LIQUIDACIÓN Y CASTIGO DE DEUDA (Convenios.gs) ----------------------
// El servidor vuelve a validar todo. Los meses originales no se borran: quedan marcados y se pueden restituir.
const CONV_NOMBRE = { REFINANCIACION: 'Refinanciación', CON_PERDON: 'Convenio con perdón', LIQUIDACION: 'Liquidación', CASTIGO: 'Castigo de deuda' };
const CONV_MAX_CUOTAS = 24, CONV_MAX_ATRASO = 2;
const convenioAbierto = (id) => (D.convenios || []).find((v) => v.ID_CLIENTE === id && (v.ESTADO === 'VIGENTE' || v.ESTADO === 'CASTIGADO'));
const cuotasConvenio = (v) => D.cargos.filter((k) => k.ID_CLIENTE === v.ID_CLIENTE && k.ANULADO !== 'Sí' &&
  (k.CONCEPTO === 'CONVENIO ' + v.ID_CONV || k.CONCEPTO === 'ENTRADA ' + v.ID_CONV));
/** Situación de un convenio vigente: cuotas que faltan, vencidas, saldo y si está en riesgo. */
function estadoConvenio(v) {
  const pend = cuotasConvenio(v);
  const vencidas = pend.filter((k) => Number(k.DIAS_ATRASO) > 0).length;
  return { faltan: pend.length, vencidas, saldo: pend.reduce((t, k) => t + Number(k.SALDO || 0), 0), riesgo: vencidas >= CONV_MAX_ATRASO,
    proxima: pend.slice().sort(ordenCargos)[0] };
}

/** Tarjeta de la ficha: convenio vigente / castigo, o el acceso para hacer uno. */
function bloqueConvenio(id, r) {
  const v = convenioAbierto(id);
  if (!v) return '';
  if (v.ESTADO === 'CASTIGADO') return `<div class="servicio convenio"><div class="serv-cab"><div><b>Deuda castigada · ${esc(v.ID_CONV)}</b>
      <small>${soles(v.DEUDA_ORIGINAL)} dada por incobrable el ${esc(txtFecha(v.FECHA))} · ${esc(v.MOTIVO)}</small></div>
      <span class="chip e-cortado">Castigada</span></div>
      <div class="acc-serv"><button class="mini" data-revertir="${esc(v.ID_CONV)}">Reabrir la deuda</button></div></div>`;
  const e = estadoConvenio(v);
  return `<div class="servicio convenio"><div class="serv-cab"><div><b>${esc(CONV_NOMBRE[v.TIPO] || v.TIPO)} · ${esc(v.ID_CONV)}</b>
      <small>Deuda ${soles(v.DEUDA_ORIGINAL)}${Number(v.PERDON) > 0 ? ' · perdón ' + soles(v.PERDON) + ' (si cumple)' : ''}${Number(v.ENTRADA) > 0 ? ' · entrada ' + soles(v.ENTRADA) : ''}
      · ${Number(v.N_CUOTAS)} cuota(s) de ${soles(v.MONTO_CUOTA)}</small>
      <small>Falta pagar ${soles(e.saldo)} en ${e.faltan} cuota(s)${e.proxima ? ' · próxima ' + esc(txtPeriodo(e.proxima.PERIODO)) : ''}${v.CONDICION ? ' · ' + esc(v.CONDICION) : ''}</small></div>
      <span class="chip ${e.riesgo ? 'e-moroso' : e.vencidas ? 'e-porvencer' : 'e-activo'}">${e.riesgo ? 'En riesgo' : e.vencidas ? e.vencidas + ' vencida' : 'Al día'}</span></div>
      ${e.riesgo ? `<p class="aviso error">${e.vencidas} cuotas vencidas. Si no se pone al día, puede revertir el convenio: la deuda (y el perdón) vuelve a los meses originales.</p>` : ''}
      <div class="acc-serv"><button class="mini rojo" data-revertir="${esc(v.ID_CONV)}">Revertir convenio</button></div></div>`;
}

/** Botón "Revertir / Reabrir" (ficha y lista de convenios). */
async function revertirConvenio(idConv) {
  const v = (D.convenios || []).find((x) => x.ID_CONV === idConv);
  if (!v) return;
  const castigo = v.ESTADO === 'CASTIGADO';
  const motivo = await pedirTexto(castigo ? 'La deuda castigada vuelve a cobrarse en sus meses originales. Motivo:'
    : 'Las cuotas sin pagar se anulan y la deuda vuelve a los meses originales, menos lo ya pagado. El perdón deja de valer. Motivo:',
  { titulo: castigo ? `¿Reabrir ${idConv}?` : `¿Revertir ${idConv}?`, si: castigo ? 'Reabrir' : 'Revertir', peligro: !castigo });
  if (motivo === null) return;
  if (motivo.trim().length < 5) return aviso('Escriba el motivo (mínimo 5 letras).', 'error');
  await encolar({ tipo: 'REVERTIR_CONVENIO', idCliente: v.ID_CLIENTE, motivo: motivo.trim(), datos: { idConv } });
  aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
}

/** Primer día de un mes "aaaa-mm" + n meses → "aaaa-mm". */
const sumarMesTxt = (aaaamm, n) => { const [a, m] = aaaamm.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

const CV_TIPOS_UI = [
  { v: 'REFINANCIACION', t: 'En cuotas', icono: 'reloj' }, { v: 'CON_PERDON', t: 'Cuotas con perdón', icono: 'check' },
  { v: 'LIQUIDACION', t: 'Pago único', icono: 'cobrar' }, { v: 'CASTIGO', t: 'Castigar', icono: 'anular' },
];
const CV_AYUDA = 'En cuotas: los meses marcados se cierran y su total se paga en cuotas, junto con la mensualidad.\nEj.: debe S/ 300 → 6 cuotas de S/ 50.\n\n' +
  'Cuotas con perdón: igual, pero la empresa perdona una parte SOLO si paga todas las cuotas.\nEj.: debe S/ 300, perdón S/ 60 → 6 cuotas de S/ 40. Si deja de pagar, se revierte y vuelve a deber todo.\n\n' +
  'Pago único: paga un monto menor hasta una fecha y se cierra todo.\nEj.: debe S/ 500, acuerdan S/ 300 hasta el 30/11.\n\n' +
  'Castigar: deuda que ya no se va a cobrar (cliente retirado). Sale de la deuda pero queda registrada; se puede reabrir.\n\n' +
  'Si las cuotas pasan al año siguiente, ese año se renueva solo.';
const CV_MOTIVOS = ['Deuda de varios meses', 'Dificultad económica', 'Error de cobro', 'Cliente retirado / no ubicable', 'Acuerdo con el cliente', 'Otro'];

/** Calcula el convenio (igual que op_crearConvenio). cfg: perdón, entrada, cuotas, mes, límite. Devuelve {error} o el detalle. */
function calcularConvenio(tipo, deuda, cfg) {
  if (!(deuda > 0)) return { error: 'Marque los meses que entran.' };
  let perdon = 0;
  if (tipo === 'CASTIGO') perdon = deuda;
  else if (tipo !== 'REFINANCIACION') {
    const v = Number(cfg.perdonV || 0), t = cfg.perdonTipo;
    if (t === 'P' && v > 100) return { error: 'El porcentaje no puede pasar de 100.' };
    perdon = r2(t === 'P' ? deuda * v / 100 : t === 'T' ? (v > 0 ? deuda - v : 0) : v);
    if (perdon < 0) return { error: 'El total acordado no puede ser mayor que la deuda.' };
    if (perdon > deuda + 0.004) return { error: 'El perdón es mayor que la deuda.' };
  }
  const conEntrada = (tipo === 'REFINANCIACION' || tipo === 'CON_PERDON') && cfg.conEntrada;
  const entrada = conEntrada ? r2(Number(cfg.entrada || 0)) : 0;
  if (conEntrada && !(entrada > 0)) return { error: 'Escriba el monto de la entrada (o quite "Con entrada").' };
  const aFin = r2(deuda - perdon - entrada);
  if (aFin < -0.004) return { error: 'La entrada es mayor que lo que queda por pagar.' };
  const filas = [];
  if (entrada > 0) filas.push([`Entrada · ${txtFecha(cfg.fEntrada)}`, entrada]);
  if (tipo === 'LIQUIDACION') {
    if (!(perdon > 0)) return { error: 'Indique el descuento o el total acordado.' };
    if (!(aFin > 0)) return { error: 'El cliente tiene que pagar algo (para no cobrar nada use "Castigar").' };
    if (!cfg.limite) return { error: 'Elija la fecha límite del pago.' };
    filas.push([`Pago único hasta el ${txtFecha(cfg.limite)}`, aFin]);
  } else if (tipo !== 'CASTIGO') {
    if (tipo === 'CON_PERDON' && !(perdon > 0)) return { error: 'Indique el perdón (o use "En cuotas").' };
    if (aFin > 0.004) {
      const n = parseInt(cfg.n, 10);
      if (!(n >= 1 && n <= CONV_MAX_CUOTAS)) return { error: `Número de cuotas entre 1 y ${CONV_MAX_CUOTAS}.` };
      if (!cfg.mes || cfg.mes < hoyISO().slice(0, 7)) return { error: 'Elija el mes de la primera cuota (este mes o después).' };
      const base = Math.floor(aFin * 100 / n) / 100;
      for (let i = 0; i < n; i++) filas.push([`Cuota ${i + 1}/${n} · ${txtPeriodo(sumarMesTxt(cfg.mes, i) + '-01')}`, i === n - 1 ? r2(aFin - base * (n - 1)) : base]);
    } else if (!(entrada > 0)) return { error: 'No queda nada por cobrar: use "Castigar".' };
  }
  const n = tipo === 'REFINANCIACION' || tipo === 'CON_PERDON' ? (aFin > 0.004 ? parseInt(cfg.n, 10) : 0) : tipo === 'LIQUIDACION' ? 1 : 0;
  return { tipo, deuda, perdon, entrada, aFin, n, filas, paga: r2(deuda - perdon) };
}

/** Resumen corto (2 líneas) de un cálculo. */
function resumenConvenio(k, cfg) {
  if (k.tipo === 'CASTIGO') return `Deja de cobrarse <b>${soles(k.deuda)}</b><small>Queda registrada como deuda castigada; se puede reabrir.</small>`;
  const cuotas = k.filas.filter((f) => /^Cuota/.test(f[0]));
  const partes = [k.entrada > 0 ? 'entrada ' + soles(k.entrada) : '',
    cuotas.length ? `${cuotas.length} cuota(s) de ${soles(cuotas[0][1])}` : '', k.tipo === 'LIQUIDACION' ? 'pago único hasta el ' + txtFecha(cfg.limite) : ''].filter(Boolean);
  const hasta = cuotas.length ? ` (${txtPeriodo(cfg.mes + '-01')} a ${txtPeriodo(sumarMesTxt(cfg.mes, cuotas.length - 1) + '-01')})` : '';
  return `Pagará <b>${soles(k.paga)}</b>${k.perdon > 0 ? ` <small class="tenue">(perdón ${soles(k.perdon)}${k.tipo === 'CON_PERDON' ? ' si cumple' : ''})</small>` : ''}
    <small>${esc(partes.join(' + '))}${esc(hasta)}</small>`;
}

function vConvenio(id) {
  const c = D.porId[id];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const abierto = convenioAbierto(id);
  if (abierto) { vista().innerHTML = `<p class="aviso">Este cliente ya tiene ${esc(abierto.ID_CONV)} (${esc(abierto.ESTADO)}). <a href="#/cliente/${esc(id)}">Volver a la ficha</a></p>`; return; }
  const cargos = cargosDe(id).filter((k) => !/^(CONVENIO|ENTRADA) CNV-/.test(k.CONCEPTO));
  const hoy = hoyISO();
  const cfg = { perdonV: '', perdonTipo: 'S', conEntrada: false, entrada: '', fEntrada: hoy, n: 6, mes: sumarMesTxt(hoy.slice(0, 7), 1), limite: '', condicion: '' };
  vista().innerHTML = `<section class="form"><h2>Convenio de pago</h2>
    <p class="sub">${esc(c.NOMBRES)} · ${esc(id)}</p>
    <h3 class="tit-ic">1. Tipo de acuerdo ${ayuda('¿Qué tipo de acuerdo?', CV_AYUDA)}</h3>
    <div class="tipos-aj" role="radiogroup" aria-label="Tipo de acuerdo">${CV_TIPOS_UI.map((x, i) => `<label><input type="radio" name="cvTipo" value="${x.v}" ${i ? '' : 'checked'}>${ic(x.icono)}${esc(x.t)}</label>`).join('')}</div>
    <h3>2. Meses que entran</h3><div id="cvMeses"></div>
    <h3>3. Cuotas</h3>
    <div class="resumen-conv" id="cvRes"></div>
    <button class="btn" id="cvCalc">${ic('calculadora')}Calcular cuotas</button>
    <h3>4. Motivo</h3>
    <label><span class="sr">Motivo</span><select id="cvMot">${CV_MOTIVOS.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
    <label id="cvDetWrap" hidden>Detalle<input id="cvDet" placeholder="Escriba el motivo"></label>
    <button class="btn grande verde" id="ok">${ic('check')}Registrar</button>
    <a class="btn secundario" href="#/cliente/${esc(id)}">Cancelar</a></section>`;
  const tipoSel = () => vista().querySelector('input[name="cvTipo"]:checked').value;
  let lm = null, calc = null;
  const pintar = () => {
    if (!lm) return;
    const tipo = tipoSel(), deuda = r2(lm.total());
    $('#cvCalc').hidden = tipo === 'CASTIGO';
    $('#cvCalc').lastChild.textContent = tipo === 'LIQUIDACION' ? 'Calcular pago único' : 'Calcular cuotas';
    const k = calcularConvenio(tipo, deuda, cfg);
    calc = k.error ? null : k;
    $('#cvRes').innerHTML = k.error ? `<span class="sub">${esc(deuda > 0 && tipo !== 'CASTIGO' ? 'Toque "' + $('#cvCalc').lastChild.textContent + '" para armar el acuerdo.' : k.error)}</span>`
      : resumenConvenio(k, cfg);
  };
  lm = listaMeses($('#cvMeses'), cargos, { marcar: 'vencidos', alCambiar: pintar });
  vista().querySelector('#cvMeses .total').innerHTML = 'Deuda seleccionada: <b class="lmTotal">' + soles(lm.total()) + '</b>';
  vista().querySelectorAll('input[name="cvTipo"]').forEach((x) => { x.onchange = pintar; });
  $('#cvMot').onchange = () => { $('#cvDetWrap').hidden = $('#cvMot').value !== 'Otro'; };
  $('#cvCalc').onclick = () => calculadoraConvenio(tipoSel(), r2(lm.total()), cfg, pintar);
  pintar();
  $('#ok').onclick = async () => {
    pintar();
    if (!lm.elegidos().length) return aviso('Marque los meses que entran.', 'error');
    if (!calc) { if (tipoSel() !== 'CASTIGO') $('#cvCalc').click(); return aviso('Complete el cálculo del acuerdo.', 'error'); }
    const det = $('#cvDet').value.trim(), motivo = $('#cvMot').value === 'Otro' ? det : $('#cvMot').value + (det ? ': ' + det : '');
    if (motivo.length < 5) return aviso('Escriba el motivo (mínimo 5 letras).', 'error');
    const datos = { tipo: calc.tipo, items: lm.elegidos().map((k) => k.ID_CARGO), condicion: String(cfg.condicion || '').trim() };
    if (calc.tipo === 'CON_PERDON' || calc.tipo === 'LIQUIDACION') datos.perdon = calc.perdon;
    if (calc.entrada > 0) Object.assign(datos, { entrada: calc.entrada, fechaEntrada: cfg.fEntrada });
    if (calc.tipo === 'LIQUIDACION') datos.fechaLimite = cfg.limite;
    else if (calc.tipo !== 'CASTIGO' && calc.aFin > 0.004) Object.assign(datos, { nCuotas: calc.n, mesInicio: cfg.mes });
    const texto = `${c.NOMBRES}\n${CONV_NOMBRE[calc.tipo]} de ${soles(calc.deuda)} (${datos.items.length} mes(es))` +
      (calc.tipo === 'CASTIGO' ? '\nLa deuda deja de cobrarse.' : `\nPagará ${soles(calc.paga)}` +
        (calc.entrada > 0 ? ` (entrada ${soles(calc.entrada)})` : '') + (datos.nCuotas ? ` en ${datos.nCuotas} cuota(s)` : '')) + `\nMotivo: ${motivo}`;
    if (!(await confirmar(texto, { titulo: calc.tipo === 'CASTIGO' ? '¿Castigar la deuda?' : '¿Registrar el convenio?', si: 'Registrar', peligro: calc.tipo === 'CASTIGO' }))) return;
    await encolar({ tipo: 'CREAR_CONVENIO', idCliente: id, motivo, datos });
    aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + id;
  };
}

/** Ventana "Calcular cuotas": todo el cálculo junto, con la tabla en vivo. Al aceptar guarda en cfg. */
function calculadoraConvenio(tipo, deuda, cfg, alAceptar) {
  if (!(deuda > 0)) return aviso('Primero marque los meses que entran.', 'error');
  const hoy = hoyISO(), conPerdon = tipo === 'CON_PERDON' || tipo === 'LIQUIDACION', cuotas = tipo === 'REFINANCIACION' || tipo === 'CON_PERDON';
  const m = modal(`<h3 id="dlgT">${tipo === 'LIQUIDACION' ? 'Pago único' : 'Calcular cuotas'}</h3>
    <div class="resumen-conv">Deuda seleccionada <b>${soles(deuda)}</b></div>
    ${conPerdon ? `<label>${tipo === 'LIQUIDACION' ? 'Descuento o total acordado' : 'Perdón (solo si cumple)'}<div class="fila"><input id="kPerdon" type="number" step="0.10" inputmode="decimal" placeholder="0.00" value="${esc(cfg.perdonV)}">
      <select id="kPerdonTipo" aria-label="Tipo"><option value="S">S/</option><option value="P">%</option><option value="T">Total a pagar S/</option></select></div></label>` : ''}
    ${cuotas ? `<label class="check"><input type="checkbox" id="kConEnt" ${cfg.conEntrada ? 'checked' : ''}> Con entrada (pago inicial)</label>
      <div id="kEntWrap" class="dos"><label>Entrada S/<input id="kEnt" type="number" step="0.10" inputmode="decimal" value="${esc(cfg.entrada)}"></label>
        <label>Fecha<input id="kFEnt" type="date" min="${hoy}" value="${esc(cfg.fEntrada)}"></label></div>
      <label>Número de cuotas<div class="contador"><button type="button" class="mini" id="kMenos" aria-label="Una cuota menos">−</button>
        <input id="kN" type="number" min="1" max="${CONV_MAX_CUOTAS}" inputmode="numeric" value="${esc(cfg.n)}"><button type="button" class="mini" id="kMas" aria-label="Una cuota más">+</button></div></label>
      <div class="atajos">${[3, 6, 12].map((x) => `<button type="button" class="mini" data-n="${x}">${x} cuotas</button>`).join('')}</div>
      <label>Primera cuota en<input id="kMes" type="month" min="${hoy.slice(0, 7)}" value="${esc(cfg.mes)}"></label>` : ''}
    ${tipo === 'LIQUIDACION' ? `<label>Fecha límite del pago<input id="kLim" type="date" min="${hoy}" value="${esc(cfg.limite)}"></label>` : ''}
    <label>Condición (opcional)<input id="kCond" value="${esc(cfg.condicion)}" placeholder="Ej.: pagar cada cuota hasta el día 4"></label>
    <div id="kPrev"></div>
    <div class="acciones"><button class="btn" id="kNo">Cancelar</button><button class="btn verde" id="kSi">Usar este cálculo</button></div>`);
  m.querySelector('.modal').classList.add('grande');
  prepararDialogo(m, () => {});
  const q = (s) => m.querySelector(s);
  if (q('#kPerdonTipo')) q('#kPerdonTipo').value = cfg.perdonTipo;
  const leer = () => {
    const o = Object.assign({}, cfg);
    if (q('#kPerdon')) Object.assign(o, { perdonV: q('#kPerdon').value, perdonTipo: q('#kPerdonTipo').value });
    if (q('#kConEnt')) Object.assign(o, { conEntrada: q('#kConEnt').checked, entrada: q('#kEnt').value, fEntrada: q('#kFEnt').value, n: q('#kN').value, mes: q('#kMes').value });
    if (q('#kLim')) o.limite = q('#kLim').value;
    o.condicion = q('#kCond').value;
    return o;
  };
  const pintar = () => {
    if (q('#kEntWrap')) q('#kEntWrap').hidden = !q('#kConEnt').checked;
    const o = leer(), k = calcularConvenio(tipo, deuda, o);
    q('#kPrev').innerHTML = k.error ? `<p class="aviso error">${esc(k.error)}</p>` : `<div class="hero calculo">
      <table class="periodos"><tbody>${k.filas.slice(0, 13).map(([t, x]) => `<tr><td>${esc(t)}</td><td>${soles(x)}</td></tr>`).join('')}
        ${k.filas.length > 13 ? `<tr><td colspan="2">… ${k.filas.length - 13} cuota(s) más</td></tr>` : ''}</tbody></table>
      <div class="totalr">Debía ${soles(deuda)} → pagará <b>${soles(k.paga)}</b></div>
      ${k.perdon > 0 ? `<p class="sub">Perdón ${soles(k.perdon)}${tipo === 'CON_PERDON' ? ', solo si paga todas las cuotas' : ''}.</p>` : ''}</div>`;
    q('#kSi').disabled = !!k.error;
  };
  m.querySelectorAll('input, select').forEach((x) => { x.addEventListener('input', pintar); x.addEventListener('change', pintar); });
  if (q('#kMenos')) {
    const setN = (v) => { q('#kN').value = Math.max(1, Math.min(CONV_MAX_CUOTAS, v)); pintar(); };
    q('#kMenos').onclick = () => setN(Number(q('#kN').value || 1) - 1);
    q('#kMas').onclick = () => setN(Number(q('#kN').value || 0) + 1);
    m.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => setN(Number(b.dataset.n)); });
  }
  q('#kNo').onclick = cerrarModal;
  q('#kSi').onclick = () => { Object.assign(cfg, leer()); cerrarModal(); alAceptar(); };
  pintar();
}

/** Más → Convenios y castigos: vigentes (en riesgo primero), castigados y cerrados recientes. */
function vConvenios() {
  const lista = (D.convenios || []).slice();
  const orden = (v) => (v.ESTADO === 'VIGENTE' ? (estadoConvenio(v).riesgo ? 0 : 1) : v.ESTADO === 'CASTIGADO' ? 2 : 3);
  lista.sort((a, b) => orden(a) - orden(b) || String(b.FECHA).localeCompare(String(a.FECHA)));
  const vig = lista.filter((v) => v.ESTADO === 'VIGENTE'), cas = lista.filter((v) => v.ESTADO === 'CASTIGADO');
  const nombre = (id) => (D.porId[id] || {}).NOMBRES || id;
  vista().innerHTML = `<h2>Convenios y castigos</h2>
    <p class="sub">${vig.length} vigente(s) · ${vig.filter((v) => estadoConvenio(v).riesgo).length} en riesgo · castigado ${soles(cas.reduce((t, v) => t + Number(v.DEUDA_ORIGINAL || 0), 0))}</p>
    <ul class="lista">${lista.map((v) => { const e = v.ESTADO === 'VIGENTE' ? estadoConvenio(v) : null;
      return `<li><a href="#/cliente/${esc(v.ID_CLIENTE)}"><div><b>${esc(nombre(v.ID_CLIENTE))}</b>
        <small>${esc(v.ID_CONV)} · ${esc(CONV_NOMBRE[v.TIPO] || v.TIPO)} · ${esc(txtFecha(v.FECHA))}</small>
        <small>${e ? `Falta ${soles(e.saldo)} en ${e.faltan} cuota(s)${e.vencidas ? ' · ' + e.vencidas + ' vencida(s)' : ''}` : 'Deuda ' + soles(v.DEUDA_ORIGINAL)}</small></div>
        <div class="der"><span class="chip ${e && e.riesgo ? 'e-moroso' : v.ESTADO === 'VIGENTE' ? 'e-activo' : v.ESTADO === 'CASTIGADO' ? 'e-cortado' : 'e-baja'}">${e && e.riesgo ? 'En riesgo' : esc(v.ESTADO)}</span></div></a></li>`; }).join('')
      || '<li class="vacio">Aún no hay convenios. Se hacen desde la ficha de un cliente con deuda vencida.</li>'}</ul>`;
}

// ---- PAUSA TEMPORAL / SUSPENSIÓN VACACIONAL ------------------------------------------------
// Máximo 60 días o 2 pausas por año calendario por cliente (lo que se cumpla primero).
// Los días pausados no se cobran (descuento por días en la cuota de cada mes). El servidor vuelve a validar todo.
const PAUSA_MAX_DIAS = 60, PAUSA_MAX_VECES = 2;
const pausaDe = (idServ) => D.suspensiones.find((x) => x.ID_SERV === idServ && (x.ESTADO === 'Programada' || x.ESTADO === 'Activa'));
const diasEntre = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T00:00:00Z')) / 864e5);
function usoPausas(idCliente, anio) {
  const l = D.suspensiones.filter((x) => x.ID_CLIENTE === idCliente && x.ESTADO !== 'Cancelada' && String(x.F_INICIO).startsWith(anio + '-'));
  return { veces: l.length, dias: l.reduce((t, x) => t + (Number(x.DIAS) || 0), 0) };
}

function vPausa(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  if (s.ESTADO !== 'Activo') { vista().innerHTML = '<p class="aviso error">Solo se pausa un servicio Activo.</p>'; return; }
  if (pausaDe(idServ)) { vista().innerHTML = '<p class="aviso">Este servicio ya tiene una pausa programada o en curso.</p>'; return; }
  const hoy = hoyISO(), tarifa = Number(s.TARIFA) || 0;
  vista().innerHTML = `<section class="form"><h2>Pausa vacacional</h2>
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.PLAN)} · ${soles(tarifa)}/mes</p>
    <p class="aviso">${ic('alerta')}<span>Máximo ${PAUSA_MAX_DIAS} días o ${PAUSA_MAX_VECES} pausas por año, lo que se cumpla primero. Los días pausados no se cobran y el PPPoE queda reservado.</span></p>
    <label>Fecha de inicio<input id="ini" type="date" value="${hoy}" min="${hoy}"></label>
    <label>Fecha de reactivación (el día que vuelve)<input id="fin" type="date" min="${hoy}"></label>
    <label>Motivo<input id="mot" value="Vacaciones" maxlength="200"></label>
    <div id="resumenPausa"></div>
    <button class="btn grande verde" id="ok">${ic('reloj')}Programar pausa</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  let valida = false;
  const pintar = () => {
    const ini = $('#ini').value, fin = $('#fin').value, cont = $('#resumenPausa');
    valida = false;
    if (!ini) { cont.innerHTML = ''; return; }
    const anio = Number(ini.slice(0, 4)), uso = usoPausas(s.ID_CLIENTE, anio);
    const lineaUso = `Uso en ${anio}: ${uso.veces} de ${PAUSA_MAX_VECES} pausas · ${uso.dias} de ${PAUSA_MAX_DIAS} días.`;
    if (!fin) { cont.innerHTML = `<p class="sub">${lineaUso} Elija la fecha de reactivación.</p>`; return; }
    const dias = diasEntre(ini, fin);
    let error = '';
    if (ini < hoy) error = 'La fecha de inicio no puede ser pasada.';
    else if (dias <= 0) error = 'La reactivación debe ser posterior al inicio.';
    else if (dias > PAUSA_MAX_DIAS) error = `Máximo ${PAUSA_MAX_DIAS} días por pausa (eligió ${dias}).`;
    else if (uso.veces >= PAUSA_MAX_VECES) error = `LÍMITE ALCANZADO: ya tuvo ${uso.veces} pausas en ${anio}.`;
    else if (uso.dias + dias > PAUSA_MAX_DIAS) error = `LÍMITE ALCANZADO: ya usó ${uso.dias} de ${PAUSA_MAX_DIAS} días en ${anio}. Le quedan ${PAUSA_MAX_DIAS - uso.dias} días.`;
    if (error) { cont.innerHTML = `<p class="aviso error">${ic('alerta')}<span>${esc(error)}</span></p><p class="sub">${lineaUso}</p>`; return; }
    // descuento estimado por mes (el servidor lo aplica sobre lo que falte pagar de cada cuota)
    const meses = [];
    let d = new Date(ini + 'T12:00:00Z');
    const f = new Date(fin + 'T12:00:00Z');
    while (d < f) {
      const a = d.getUTCFullYear(), m = d.getUTCMonth(), diasMes = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
      const sig = new Date(Date.UTC(a, m + 1, 1, 12)), hasta = sig < f ? sig : f;
      const n = Math.round((hasta - d) / 864e5);
      meses.push({ per: `${a}-${String(m + 1).padStart(2, '0')}`, n, diasMes, monto: n >= diasMes ? tarifa : r2(tarifa * n / diasMes) });
      d = sig;
    }
    valida = true;
    cont.innerHTML = `<div class="hero calculo"><span class="eyebrow">${dias} día(s) de pausa · del ${esc(txtFecha(ini))} al ${esc(txtFecha(fin))}</span>
      <table class="periodos"><tbody>${meses.map((m) => `<tr><td>${esc(txtPeriodo(m.per))}: ${m.n} de ${m.diasMes} días sin cobrar</td><td>− ${soles(m.monto)}</td></tr>`).join('')}</tbody></table>
      <div class="totalr">Descuento estimado <b>${soles(meses.reduce((t, m) => t + m.monto, 0))}</b></div>
      <p class="sub">${ini === hoy ? 'El servicio se suspende hoy' : 'El servicio sigue Activo hasta el ' + esc(txtFecha(ini))} y vuelve solo el ${esc(txtFecha(fin))}.
        Después de esta pausa: ${uso.veces + 1} de ${PAUSA_MAX_VECES} pausas · ${uso.dias + dias} de ${PAUSA_MAX_DIAS} días en ${anio}.</p></div>`;
  };
  ['#ini', '#fin'].forEach((x) => { $(x).onchange = pintar; $(x).oninput = pintar; });
  pintar();
  $('#ok').onclick = async () => {
    if (!valida) return aviso('Revise las fechas de la pausa.', 'error');
    const ini = $('#ini').value, fin = $('#fin').value;
    if (!(await confirmar(`${s.CLIENTE}\nDel ${txtFecha(ini)} al ${txtFecha(fin)} (${diasEntre(ini, fin)} días)`, { titulo: '¿Programar la pausa vacacional?', si: 'Programar' }))) return;
    await encolar({ tipo: 'PAUSA_VACACIONES', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, fecha: ini, motivo: $('#mot').value.trim() || 'Vacaciones', datos: { fin } });
    aviso(navigator.onLine ? 'Pausa enviada.' : 'Guardada sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

// ============================================================================
// ÓRDENES DE TRABAJO Y HOJAS DE RUTA (registro, documento imprimible, acciones del técnico)
// ============================================================================
const OT_TITULO = { CAMBIO_PLAN: 'ORDEN DE TRABAJO', RUTA_CORTE: 'HOJA DE RUTA DE CORTES', ORDEN_CORTE: 'ORDEN DE CORTE', ORDEN_SERVICIO: 'ORDEN DE SERVICIO', ORDEN_LIBRE: 'ORDEN DE TRABAJO' };
const OT_NOMBRE = { CAMBIO_PLAN: 'Orden de trabajo · cambio de plan', RUTA_CORTE: 'Hoja de ruta de cortes', ORDEN_CORTE: 'Orden de corte', ORDEN_SERVICIO: 'Orden de servicio', ORDEN_LIBRE: 'Orden libre' };
const chipOt = (e) => ({ Pendiente: 'e-porvencer', Completada: 'e-activo', Anulada: 'e-baja', Ejecutado: 'e-activo', 'No ejecutado': 'e-cortado', Anulado: 'e-baja' }[e] || 'e-pend');
const enlaceMapa = (gps) => 'https://maps.google.com/?q=' + encodeURIComponent(String(gps).replace(/\s+/g, ''));

/** Foto local de los datos del cliente (mismas claves que el servidor) para imprimir aunque no haya señal. */
function snapshotLocal(idCli, idServ) {
  const c = D.porId[idCli] || {}, sv = servicioPorId(idServ) || {}, r = D.resumen[idCli] || {};
  return { n: c.NOMBRES || sv.CLIENTE || '', doc: c.DNI_RUC || '', tel: c.TELEFONO || '', tel2: c.TELEFONO2 || '', dir: c.DIRECCION || '',
    ref: c.REFERENCIA || '', zona: c.ZONA || '', gps: c.COORDENADAS || '', plan: sv.PLAN || '', tarifa: Number(sv.TARIFA) || 0, modo: sv.MODO || '',
    pppoe: sv.PPPOE || '', estado: sv.ESTADO || '', deuda: Number(r.DEUDA_VENCIDA) || 0, meses: Number(r.MESES_ADEUDA) || 0, dias: Number(r.DIAS_ATRASO) || 0 };
}

/**
 * Todas las órdenes que conoce el celular: las sincronizadas + las creadas aquí que aún no llegaron,
 * con las marcas (ejecutado / no ejecutado / anulada) que están en la cola de envío.
 */
async function ordenesLocales() {
  const cola = await colaTodos();
  const vivas = (o) => ['pendiente', 'enviado', 'error'].includes(o.estadoLocal);
  const lista = D.ordenes.map((o) => ({
    ref: o.ID_OT, id: o.ID_OT, solicitud: o.ID_SOLICITUD, tipo: o.TIPO, estado: o.ESTADO, fecha: o.F_CREACION, usuario: o.USUARIO,
    detalle: o.DETALLE, datos: o.DATOS || {}, cierre: o.F_CIERRE, obsCierre: o.OBS_CIERRE, local: false,
    items: D.ordenesDet.filter((d) => d.ID_OT === o.ID_OT).map((d) => ({ idServ: d.ID_SERV, idCliente: d.ID_CLIENTE, estado: d.ESTADO,
      snap: d.SNAPSHOT || {}, obs: d.OBS, fEjec: d.F_EJEC })),
  }));
  const conocidas = new Set(lista.map((o) => o.solicitud).filter(Boolean));
  cola.filter((o) => o.tipo === 'CREAR_ORDEN' && o.estadoLocal !== 'rechazado' && !conocidas.has(o.idSolicitud) && o.vista).forEach((o) => {
    const res = o.resultado || {};
    lista.push({ ref: o.idSolicitud, id: (res.datos && res.datos.idOt) || 'PROVISIONAL', solicitud: o.idSolicitud, tipo: o.vista.tipo, estado: 'Pendiente',
      fecha: o.fDispositivo, usuario: PERFIL.email, detalle: o.vista.tipo === 'RUTA_CORTE' ? o.vista.items.length + ' cliente(s) a cortar'
        : o.vista.tipo === 'ORDEN_CORTE' ? 'Corte de ' + o.vista.items[0].idServ
        : o.vista.tipo === 'ORDEN_SERVICIO' ? (o.vista.datos.trabajo || '') + (o.vista.datos.motivo ? ': ' + o.vista.datos.motivo : '')
        : o.vista.tipo === 'ORDEN_LIBRE' ? (o.vista.datos.titulo || '') + (o.vista.datos.nombre ? ' · ' + o.vista.datos.nombre : '')
        : `${o.vista.datos.planAnt} → ${o.vista.datos.plan}`, datos: o.vista.datos || {}, local: true,
      items: o.vista.items.map((x) => ({ idServ: x.idServ, idCliente: x.idCliente, estado: 'Pendiente', snap: x.snap })) });
  });
  // marcas aún sin enviar
  cola.filter((o) => vivas(o) && (o.tipo === 'CERRAR_ITEM_ORDEN' || o.tipo === 'ANULAR_ORDEN')).forEach((op) => {
    const ot = lista.find((x) => x.ref === op.datos.ref || x.solicitud === op.datos.ref || x.id === op.datos.ref);
    if (!ot) return;
    if (op.tipo === 'ANULAR_ORDEN') { ot.estado = 'Anulada'; ot.sinEnviar = true; ot.items.forEach((it) => { if (it.estado === 'Pendiente') it.estado = 'Anulado'; }); return; }
    const it = ot.items.find((x) => x.idServ === op.idServ);
    if (it && it.estado === 'Pendiente') { it.estado = op.datos.resultado === 'EJECUTADO' ? 'Ejecutado' : 'No ejecutado'; it.obs = op.motivo || ''; it.fEjec = op.fecha; it.sinEnviar = true; }
    if (ot.estado === 'Pendiente' && ot.items.every((x) => x.estado !== 'Pendiente')) ot.estado = 'Completada';
  });
  return lista.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ---- NUEVA ORDEN: para un cliente (buscador) o libre (sin cliente registrado / pendientes) -------
async function vNuevaOrden(modo) {
  if (modo === 'libre') return vOrdenLibre();
  vista().innerHTML = `<section class="form"><a class="volver" href="#/ordenes">${ic('atras')}Órdenes</a><h2>Orden para un cliente</h2>
    <label><span class="sr">Buscar cliente</span><input id="noBus" type="search" placeholder="Nombre, DNI, celular o código" autocomplete="off"></label>
    <ul class="lista" id="noRes"></ul>
    <p class="sub">¿No está registrado? <a href="#/nuevaorden/libre">Haga una orden libre</a>.</p></section>`;
  const pintar = () => {
    const q = $('#noBus').value.trim();
    const res = q.length >= 2 ? buscarClientes(q, 20) : [];
    $('#noRes').innerHTML = res.map((c) => { const ss = serviciosDe(c.ID_CLIENTE).filter((s) => s.ESTADO !== 'Baja');
      return `<li><a href="#" data-cli="${esc(c.ID_CLIENTE)}"><div><b>${esc(c.NOMBRES)}</b><small>${esc(c.ID_CLIENTE)} · ${esc(c.ZONA || '')} · ${ss.map((s) => esc(nombreCorto({ CONCEPTO: 'MENSUALIDAD', PLAN: s.PLAN }))).join(' + ') || 'sin servicios'}</small></div>${ic('flecha')}</a></li>`; }).join('')
      || (q.length >= 2 ? '<li class="vacio">Sin resultados.</li>' : '');
    $('#noRes').querySelectorAll('[data-cli]').forEach((a) => { a.onclick = (e) => {
      e.preventDefault();
      const ss = serviciosDe(a.dataset.cli).filter((s) => s.ESTADO !== 'Baja');
      if (!ss.length) return aviso('El cliente no tiene servicios: use una orden libre.', 'error');
      const duo = serviciosDuo(a.dataset.cli);
      const base = duo ? duo.internet[0] : null;                 // paquete DUO: la visita es del cliente; va sobre el internet
      if (ss.length === 1 || base) { location.hash = '#/ordenserv/' + (base || ss[0]).ID_SERV; return; }
      menuOpciones('¿Para qué servicio?', ss.map((s) => ({ t: `${nombreServicio(s.PLAN)} · ${s.ESTADO}`, icono: esCatv(s) ? 'tv' : 'wifi', href: '#/ordenserv/' + s.ID_SERV })));
    }; });
  };
  $('#noBus').oninput = pintar;
  $('#noBus').focus();
}

function vOrdenLibre() {
  vista().innerHTML = `<section class="form"><a class="volver" href="#/ordenes">${ic('atras')}Órdenes</a><h2>Orden libre</h2>
    <p class="sub">Para trabajos fuera de la cartera: una persona no registrada, una lista de pendientes, mantenimiento de red…</p>
    <label>Trabajo *<input id="ol_titulo" placeholder="Ej.: Instalación nueva / Revisar caja NAP zona centro"></label>
    <h3>Tareas *</h3>
    <ul class="tareas lista-limpia" id="olTareas"></ul>
    <button type="button" class="mini" id="olMas">${ic('agregar')}Agregar tarea</button>
    <h3>Persona / lugar <small class="sub">(opcional)</small></h3>
    <label>Nombre<input id="ol_nombre"></label>
    <div class="dos"><label>Celular<input id="ol_tel" inputmode="numeric"></label><label>Técnico<input id="ol_tecnico"></label></div>
    <label>Dirección<input id="ol_dir"></label>
    <label>Referencia<input id="ol_ref"></label>
    <label>Zona<select id="ol_zona"><option value="">— sin zona —</option>${lst('ZONA').map((z) => `<option>${esc(z)}</option>`).join('')}</select></label>
    <label>Ubicación<div class="fila"><input id="ol_gps" placeholder="-11.44, -74.43" inputmode="decimal"><button type="button" class="mini" id="olAqui">${ic('ubicacion')}Aquí</button><button type="button" class="mini" id="olMapa">${ic('mapa')}Mapa</button></div></label>
    <div class="dos"><label>Fecha<input id="ol_fecha" type="date" value="${hoyISO()}"></label><label>Hora<input id="ol_hora" type="time"></label></div>
    <label>Cobrar (S/, opcional)<input id="ol_cobrar" type="number" step="0.10" inputmode="decimal" placeholder="0.00"></label>
    <label>Observaciones<textarea id="ol_obs" rows="2"></textarea></label>
    <button class="btn grande verde" id="ok">${ic('documento')}Generar orden</button>
    <a class="btn secundario" href="#/ordenes">Cancelar</a></section>`;
  const agregar = (txt = '') => {
    const li = document.createElement('li');
    li.innerHTML = `<input class="olT" maxlength="200" placeholder="Ej.: cambiar conector" value="${esc(txt)}"><button type="button" class="mini" aria-label="Quitar tarea">${ic('cerrar')}</button>`;
    li.querySelector('button').onclick = () => { if ($('#olTareas').children.length > 1) li.remove(); else li.querySelector('input').value = ''; };
    $('#olTareas').appendChild(li);
    return li.querySelector('input');
  };
  agregar();
  $('#olMas').onclick = () => { if ($('#olTareas').children.length >= 30) return aviso('Máximo 30 tareas.', 'error'); agregar().focus(); };
  // ubicación: "Aquí" toma el GPS del celular; "Mapa" permite marcar el punto (también buscar desde la ubicación actual)
  $('#olMapa').onclick = async () => { const r = await elegirEnMapa($('#ol_gps').value); if (r) $('#ol_gps').value = r; };
  $('#olAqui').onclick = () => {
    if (!navigator.geolocation) return aviso('Este celular no permite ubicación.', 'error');
    navigator.geolocation.getCurrentPosition((p) => { $('#ol_gps').value = p.coords.latitude.toFixed(5) + ',' + p.coords.longitude.toFixed(5); },
      () => aviso('No se pudo obtener la ubicación. Active el GPS o use Mapa.', 'error'), { enableHighAccuracy: true, timeout: 15000 });
  };
  $('#ok').onclick = async () => {
    const v = (k) => $('#ol_' + k).value.trim();
    const tareas = [...vista().querySelectorAll('.olT')].map((x) => x.value.trim()).filter(Boolean);
    const datos = {};
    ['titulo', 'nombre', 'tel', 'dir', 'ref', 'gps', 'zona', 'tecnico', 'fecha', 'hora', 'obs'].forEach((k) => { if (v(k)) datos[k] = v(k); });
    if (v('cobrar')) datos.cobrar = r2(Number(v('cobrar')));
    if (!datos.titulo || datos.titulo.length < 3) return aviso('Escriba qué trabajo es.', 'error');
    if (!tareas.length) return aviso('Escriba al menos una tarea.', 'error');
    if (datos.cobrar !== undefined && !(datos.cobrar >= 0)) return aviso('Monto a cobrar inválido.', 'error');
    if (!(await confirmar(`${datos.titulo}${datos.nombre ? '\n' + datos.nombre : ''}\n${tareas.length} tarea(s)`, { titulo: '¿Generar orden libre?', si: 'Generar' }))) return;
    const servicio = Object.assign({ tareas }, datos);
    const op = { tipo: 'CREAR_ORDEN', datos: { tipo: 'ORDEN_LIBRE', items: [], servicio },
      vista: { tipo: 'ORDEN_LIBRE', datos, items: tareas.map((t, i) => ({ idServ: 'T' + (i + 1), idCliente: '', snap: { tarea: t } })) } };
    await encolar(op);
    aviso(navigator.onLine ? 'Orden enviada.' : 'Orden guardada sin señal: ya puede imprimirla.');
    location.hash = '#/orden/' + op.idSolicitud;
  };
}

// ---- REGISTRO: filtros por fechas; las pendientes siempre visibles --------------------------
async function vOrdenes() {
  const hoy = hoyISO(), hace3 = new Date(hoy + 'T12:00:00'); hace3.setMonth(hace3.getMonth() - 3);
  const f = Object.assign({ desde: hace3.toISOString().slice(0, 8) + '01', hasta: hoy, tipo: '', estado: '', zona: '' }, (await kvGet('filtrosOrdenes')) || {});
  const todasOt = await ordenesLocales();
  const zonas = [...new Set(lst('ZONA').concat(todasOt.map(zonaOrden)).filter(Boolean))].sort();
  if (f.hasta < hoy) f.hasta = hoy;                    // el historial siempre llega hasta hoy
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  vista().innerHTML = `<h2 class="tit-ic">Órdenes y hojas de ruta ${ayuda('Órdenes', 'Las pendientes aparecen siempre, hasta que se completen o se anulen.\nNueva orden → Para un cliente (visita técnica de un cliente registrado) u Orden libre (persona no registrada o lista de pendientes).')}</h2>
    <button class="btn verde" id="oNueva">${ic('agregar')}Nueva orden</button>
    <div class="filtros">
      <label>Desde<input id="oDesde" type="date" value="${esc(f.desde)}"></label>
      <label>Hasta<input id="oHasta" type="date" value="${esc(f.hasta)}"></label>
      <label>Tipo<select id="oTipo">${opt('', 'Todos', f.tipo)}${opt('CAMBIO_PLAN', 'Órdenes de trabajo', f.tipo)}${opt('ORDEN_CORTE', 'Órdenes de corte', f.tipo)}${opt('ORDEN_SERVICIO', 'Órdenes de servicio', f.tipo)}${opt('RUTA_CORTE', 'Hojas de ruta', f.tipo)}${opt('ORDEN_LIBRE', 'Órdenes libres', f.tipo)}</select></label>
      <label>Estado<select id="oEstado">${opt('', 'Todos', f.estado)}${opt('Pendiente', 'Pendientes', f.estado)}${opt('Completada', 'Completadas', f.estado)}${opt('Anulada', 'Anuladas', f.estado)}</select></label>
      <label>Zona<select id="oZona">${opt('', 'Todas', f.zona)}${zonas.map((z) => opt(z, z, f.zona)).join('')}</select></label>
    </div>
    <div id="oLista"></div>`;
  const fila = (o) => {
    const hechos = o.items.filter((x) => x.estado !== 'Pendiente').length, tv = OT_VISUAL[o.tipo] || ['documento', 'gris'];
    const esHoy = o.estado === 'Pendiente' && fechaOrden(o) === hoy, z = zonaOrden(o);
    return `<li class="ot-fila"><a href="#/orden/${encodeURIComponent(o.ref)}"><span class="ta-ic c-${tv[1]}">${ic(tv[0])}</span>
      <div><b>${esc(OT_NOMBRE[o.tipo] || o.tipo)}</b>${esHoy ? ' <span class="chip e-porvencer">Hoy</span>' : ''}
      <small>${esc(o.id)} · ${esc(txtFecha(fechaOrden(o)))}${o.datos && o.datos.hora ? ' ' + esc(o.datos.hora) : ''}${z ? ' · ' + ic('mapa') + esc(z) : ''}</small>
      <small>${esc(o.detalle)}</small>
      <small>${hechos} de ${o.items.length} resuelto(s)${o.local ? ' · sin enviar' : ''}</small></div>
      <div class="der"><span class="chip ${chipOt(o.estado)}">${esc(o.estado)}</span></div></a></li>`;
  };
  // pendientes agrupadas por zona (las de hoy primero dentro de cada zona)
  const porZona = (lista) => {
    if (f.zona) return `<ul class="lista">${lista.map(fila).join('')}</ul>`;
    const g = {};
    lista.forEach((o) => { const z = zonaOrden(o) || 'Sin zona'; (g[z] = g[z] || []).push(o); });
    return Object.keys(g).sort().map((z) => `<h4 class="zona-tit">${ic('mapa')}${esc(z)} <span class="cuenta">${g[z].length}</span></h4>
      <ul class="lista">${g[z].sort((a, b) => fechaOrden(a).localeCompare(fechaOrden(b))).map(fila).join('')}</ul>`).join('');
  };
  const pintar = async () => {
    Object.assign(f, { desde: $('#oDesde').value, hasta: $('#oHasta').value, tipo: $('#oTipo').value, estado: $('#oEstado').value, zona: $('#oZona').value });
    await kvSet('filtrosOrdenes', f);
    const todas = (await ordenesLocales()).filter((o) => (!f.tipo || o.tipo === f.tipo) && (!f.zona || zonaOrden(o) === f.zona));
    const pend = todas.filter((o) => o.estado === 'Pendiente');
    const dia = (o) => String(o.fecha).slice(0, 10);
    const periodo = todas.filter((o) => o.estado !== 'Pendiente' && (!f.estado || o.estado === f.estado) && (!f.desde || dia(o) >= f.desde) && (!f.hasta || dia(o) <= f.hasta));
    $('#oLista').innerHTML = (!f.estado || f.estado === 'Pendiente' ? `<h3>Pendientes (${pend.length})</h3>
      ${pend.length ? porZona(pend) : '<p class="vacio">No hay órdenes pendientes.</p>'}` : '') +
      (f.estado !== 'Pendiente' ? `<h3>Historial: completadas y anuladas del ${esc(txtFecha(f.desde))} al ${esc(txtFecha(f.hasta))} (${periodo.length})</h3>
      <ul class="lista">${periodo.map(fila).join('') || '<li class="vacio">Nada en esas fechas.</li>'}</ul>` : '');
  };
  ['#oDesde', '#oHasta', '#oTipo', '#oEstado', '#oZona'].forEach((x) => { $(x).onchange = pintar; });
  $('#oNueva').onclick = () => menuOpciones('Nueva orden', [
    { t: 'Para un cliente registrado', icono: 'usuario', href: '#/nuevaorden' },
    { t: 'Orden libre (sin cliente / pendientes)', icono: 'lista', href: '#/nuevaorden/libre' }]);
  pintar();
}

/** Ícono y color de cada tipo de orden. */
const OT_VISUAL = { CAMBIO_PLAN: ['ajustes', 'violeta'], ORDEN_CORTE: ['cortar', 'rojo'], RUTA_CORTE: ['mapa', 'rojo'], ORDEN_SERVICIO: ['router', 'azul'], ORDEN_LIBRE: ['lista', 'gris'] };
/** Zona de una orden: la de la orden libre o la de los clientes de su foto. */
const zonaOrden = (o) => String((o.datos && o.datos.zona) || [...new Set((o.items || []).map((it) => (it.snap || {}).zona).filter(Boolean))].join(', ') || '');

/** HTML del documento (misma plantilla que el recibo PDF). */
function htmlDocumento(o, logo = 'icons/icono-192.png') {
  const cfg = D.config, t = (v) => esc(v || '—');
  const cab1 = [cfg.RUC ? 'RUC: ' + cfg.RUC : '', cfg.Direccion].filter(Boolean).join('  ·  ');
  const cab2 = [cfg.Telefono ? 'Cel.: ' + cfg.Telefono : '', cfg.Email].filter(Boolean).join('  ·  ');
  const total = o.items.reduce((s, x) => s + (Number(x.snap.deuda) || 0), 0);
  const tels = (sn) => [sn.tel, sn.tel2].filter(Boolean).map((x) => `<a href="tel:${esc(x)}">${esc(x)}</a>`).join(' / ') || '—';
  const ubic = (sn) => sn.gps ? `<a class="mapa-link" href="${enlaceMapa(sn.gps)}" target="_blank" rel="noopener">${esc(sn.gps)} · Abrir en Google Maps</a>` : 'Sin coordenadas';
  const cabecera = `<header class="doc-cab"><img src="${logo}" alt="" width="52" height="52">
    <div class="doc-neg"><b>${esc(cfg.Negocio || 'D@NDINET')}</b>${cab1 ? `<small>${esc(cab1)}</small>` : ''}${cab2 ? `<small>${esc(cab2)}</small>` : ''}</div>
    <div class="doc-caja"><span>${OT_TITULO[o.tipo] || 'DOCUMENTO'}</span><strong>N° ${esc(o.id)}</strong><span>Fecha: ${esc(txtFecha(o.fecha))}</span>
      <em>${o.estado === 'Pendiente' ? 'PENDIENTE' : esc(o.estado.toUpperCase())}</em></div></header>`;
  let cuerpo = '';
  if (o.tipo === 'ORDEN_SERVICIO') {
    const it0 = o.items[0] || {}, sn = it0.snap || {}, d = o.datos || {};
    cuerpo = `<table class="doc-campos"><tbody>
        <tr><th>Cliente</th><td><b>${t(sn.n)}</b></td></tr><tr><th>Código</th><td>${t(it0.idCliente)} · DNI/RUC ${t(sn.doc)}</td></tr>
        <tr><th>Teléfono</th><td>${tels(sn)}</td></tr><tr><th>Dirección</th><td>${t(sn.dir)}</td></tr><tr><th>Referencia</th><td>${t(sn.ref)}</td></tr>
        <tr><th>Zona</th><td>${t(sn.zona)}</td></tr><tr><th>Ubicación</th><td>${ubic(sn)}</td></tr>
        <tr><th>Servicio</th><td>${t(sn.plan)} · PPPoE ${t(sn.pppoe)} · Equipo: ${t(sn.modo)}</td></tr></tbody></table>
      <h4 class="doc-sec">DETALLE DEL TRABAJO</h4>
      <table class="doc-campos"><tbody>
        <tr><th>Trabajo</th><td><b>${t(d.trabajo)}</b></td></tr>
        ${d.motivo ? `<tr><th>Descripción</th><td>${esc(d.motivo)}</td></tr>` : ''}
        <tr><th>Programado</th><td>${t(txtFecha(d.fecha))}${d.hora ? ' · ' + esc(d.hora) : ''}</td></tr>
        <tr><th>Técnico</th><td>${t(d.tecnico)}</td></tr>
        ${Number(d.cobrar) > 0 ? `<tr><th>Cobrar</th><td><b class="doc-rojo">${soles(d.cobrar)}</b></td></tr>` : ''}
        ${d.obs ? `<tr><th>Observaciones</th><td>${esc(d.obs)}</td></tr>` : ''}</tbody></table>
      ${it0.estado && it0.estado !== 'Pendiente' ? `<p class="doc-resultado">${esc(it0.estado === 'Ejecutado' ? 'Hecho' : it0.estado)} el ${esc(txtFecha(it0.fEjec))}${it0.obs ? ' · ' + esc(it0.obs) : ''}</p>`
        : '<p class="doc-casillas">☐ Hecho &nbsp; ☐ No se pudo &nbsp; Trabajo realizado / materiales: ________________________</p>'}
      <div class="doc-firmas"><div>Hora de llegada: ______ &nbsp; Hora de salida: ______</div><div>Observaciones: ______________________</div>
        <div class="firma">Firma del técnico</div><div class="firma">Firma del cliente</div></div>`;
  } else if (o.tipo === 'ORDEN_LIBRE') {
    const d = o.datos || {};
    cuerpo = `<table class="doc-campos"><tbody>
        <tr><th>Trabajo</th><td><b>${t(d.titulo)}</b></td></tr>
        ${d.nombre ? `<tr><th>Persona</th><td>${esc(d.nombre)}</td></tr>` : ''}${d.tel ? `<tr><th>Teléfono</th><td>${tels({ tel: d.tel })}</td></tr>` : ''}
        ${d.dir ? `<tr><th>Dirección</th><td>${esc(d.dir)}</td></tr>` : ''}${d.ref ? `<tr><th>Referencia</th><td>${esc(d.ref)}</td></tr>` : ''}
        ${d.zona ? `<tr><th>Zona</th><td>${esc(d.zona)}</td></tr>` : ''}${d.gps ? `<tr><th>Ubicación</th><td>${ubic(d)}</td></tr>` : ''}
        <tr><th>Programado</th><td>${t(txtFecha(d.fecha))}${d.hora ? ' · ' + esc(d.hora) : ''}</td></tr><tr><th>Técnico</th><td>${t(d.tecnico)}</td></tr>
        ${Number(d.cobrar) > 0 ? `<tr><th>Cobrar</th><td><b class="doc-rojo">${soles(d.cobrar)}</b></td></tr>` : ''}
        ${d.obs ? `<tr><th>Observaciones</th><td>${esc(d.obs)}</td></tr>` : ''}</tbody></table>
      <h4 class="doc-sec">TAREAS</h4>
      ${o.items.map((it, i) => `<article class="doc-item"><h4><span>${i + 1}. ${t((it.snap || {}).tarea)}</span><span class="doc-estado ${chipOt(it.estado)}">${esc(it.estado === 'Ejecutado' ? 'Hecho' : it.estado)}</span></h4>
        ${it.estado !== 'Pendiente' ? (it.obs ? `<p class="doc-resultado">${esc(it.obs)}</p>` : '') : '<p class="doc-casillas">☐ Hecho &nbsp; ☐ No se pudo &nbsp; Obs.: ________________________</p>'}
        <div class="no-imprimir acc-item" data-serv="${esc(it.idServ)}"></div></article>`).join('')}
      <div class="doc-firmas"><div class="firma">Firma del técnico</div><div class="firma">Conformidad</div></div>`;
  } else if (o.tipo === 'CAMBIO_PLAN') {
    const sn = (o.items[0] || {}).snap || {}, d = o.datos || {};
    cuerpo = `<table class="doc-campos"><tbody>
        <tr><th>Cliente</th><td><b>${t(sn.n)}</b></td></tr><tr><th>Código</th><td>${t((o.items[0] || {}).idCliente)} · DNI/RUC ${t(sn.doc)}</td></tr>
        <tr><th>Teléfono</th><td>${tels(sn)}</td></tr><tr><th>Dirección</th><td>${t(sn.dir)}</td></tr><tr><th>Referencia</th><td>${t(sn.ref)}</td></tr>
        <tr><th>Zona</th><td>${t(sn.zona)}</td></tr><tr><th>Ubicación</th><td>${ubic(sn)}</td></tr>
        <tr><th>PPPoE</th><td>${t(sn.pppoe)} · Equipo: ${t(sn.modo)}</td></tr></tbody></table>
      <h4 class="doc-sec">DETALLE DEL TRABAJO · CAMBIO DE PLAN / TECNOLOGÍA</h4>
      <table class="doc-det"><thead><tr><th></th><th>Plan</th><th>Tarifa</th></tr></thead><tbody>
        <tr><td>Actual</td><td>${t(d.planAnt || sn.plan)}</td><td>${soles(d.tarifaAnt || sn.tarifa)}</td></tr>
        <tr><td><b>Nuevo</b></td><td><b>${t(d.plan)}</b></td><td><b>${soles(d.tarifa)}</b></td></tr></tbody></table>
      <p class="doc-nota">El cambio se aplica el día de la instalación, con prorrateo por días${d.ajuste !== undefined ? ` (ajuste fijado: ${soles(d.ajuste)})` : ''}.</p>
      ${o.items[0] && o.items[0].estado !== 'Pendiente' ? `<p class="doc-resultado">${esc(o.items[0].estado)} el ${esc(txtFecha(o.items[0].fEjec))}${o.items[0].obs ? ' · ' + esc(o.items[0].obs) : ''}</p>` : ''}
      <div class="doc-firmas"><div>Fecha de instalación: ____ / ____ / ______</div><div>Observaciones: ______________________</div>
        <div class="firma">Firma del técnico</div><div class="firma">Firma del cliente</div></div>`;
  } else {
    const zonas = [...new Set(o.items.map((x) => x.snap.zona).filter(Boolean))];
    cuerpo = `<div class="doc-resumen"><div><span>Clientes</span><b>${o.items.length}</b></div><div><span>Zona(s)</span><b>${esc(zonas.join(', ') || '—')}</b></div>
        <div class="doc-total"><span>Deuda total</span><b>${soles(total)}</b></div></div>
      ${o.items.map((it, i) => { const sn = it.snap || {}; return `<article class="doc-item">
        <h4><span>${i + 1}. ${t(sn.n)} <small>(${esc(it.idCliente)} · ${esc(it.idServ)})</small></span><span class="doc-estado ${chipOt(it.estado)}">${esc(it.estado)}</span></h4>
        <table class="doc-campos"><tbody>
          <tr><th>Dirección</th><td>${t(sn.dir)}</td></tr><tr><th>Referencia</th><td>${t(sn.ref)}</td></tr>
          <tr><th>Zona · Plan</th><td>${t(sn.zona)} · ${t(sn.plan)} (${soles(sn.tarifa)})</td></tr><tr><th>PPPoE</th><td>${t(sn.pppoe)}</td></tr>
          <tr><th>Teléfono</th><td>${tels(sn)}</td></tr><tr><th>Ubicación</th><td>${ubic(sn)}</td></tr>
          <tr><th>Deuda</th><td><b class="doc-rojo">${soles(sn.deuda)}</b> · ${Number(sn.meses) || 0} cuota(s) · ${esc(txtMora(sn.dias))} de atraso</td></tr></tbody></table>
        ${it.estado !== 'Pendiente' ? `<p class="doc-resultado">${esc(it.estado)}${it.fEjec ? ' el ' + esc(txtFecha(it.fEjec)) : ''}${it.obs ? ' · ' + esc(it.obs) : ''}</p>`
          : '<p class="doc-casillas">☐ Cortado &nbsp; ☐ No cortado &nbsp; Motivo / obs.: ________________________</p>'}
        <div class="no-imprimir acc-item" data-serv="${esc(it.idServ)}"></div></article>`; }).join('')}
      <div class="doc-firmas"><div class="firma">Firma del técnico</div><div class="firma">V.° B.° administración</div></div>`;
  }
  return `<div class="doc">${cabecera}${cuerpo}
    <footer class="doc-pie">Documento interno de control ${esc(cfg.Negocio || 'D@NDINET')}. Generado por ${esc(o.usuario || '')} el ${esc(txtFecha(o.fecha))} ${esc(String(o.fecha).slice(11, 16))}.
      ${o.local ? 'N° provisional: el número definitivo se asigna al sincronizar.' : ''}</footer></div>`;
}

/** Texto para compartir por WhatsApp (con los enlaces de Google Maps). */
function textoOrden(o) {
  const l = [`*${OT_TITULO[o.tipo]} ${o.id}* (${txtFecha(o.fecha)})`];
  if (o.tipo === 'ORDEN_LIBRE') {
    const d = o.datos || {};
    l.push(`*${d.titulo || ''}*`);
    if (d.nombre || d.tel) l.push([d.nombre, d.tel].filter(Boolean).join(' · '));
    if (d.dir) l.push(`Dirección: ${d.dir}${d.ref ? ' (Ref.: ' + d.ref + ')' : ''}`);
    if (d.gps) l.push(`Mapa: ${enlaceMapa(d.gps)}`);
    l.push(`Fecha: ${txtFecha(d.fecha)}${d.hora ? ' ' + d.hora : ''}${d.tecnico ? ' · Técnico: ' + d.tecnico : ''}`);
    o.items.forEach((it, i) => l.push(`${i + 1}. ${(it.snap || {}).tarea || ''}${it.estado !== 'Pendiente' ? ' (' + it.estado + ')' : ''}`));
    if (Number(d.cobrar) > 0) l.push(`Cobrar: ${soles(d.cobrar)}`);
    return l.join('\n');
  }
  o.items.forEach((it, i) => {
    const sn = it.snap || {};
    l.push(`\n${o.tipo === 'RUTA_CORTE' ? (i + 1) + '. ' : ''}*${sn.n}* (${it.idCliente})`, `Dirección: ${sn.dir || '—'}${sn.ref ? ' (Ref.: ' + sn.ref + ')' : ''}`,
      `Zona: ${sn.zona || '—'} · Plan: ${sn.plan || '—'} · PPPoE: ${sn.pppoe || '—'}`, `Tel.: ${[sn.tel, sn.tel2].filter(Boolean).join(' / ') || '—'}`);
    if (sn.gps) l.push(`Mapa: ${enlaceMapa(sn.gps)}`);
    if (o.tipo === 'ORDEN_CORTE' || o.tipo === 'RUTA_CORTE') l.push(`Deuda: ${soles(sn.deuda)} (${txtMora(sn.dias)})`);
  });
  if (o.tipo === 'CAMBIO_PLAN') l.push(`\nCambio: ${o.datos.planAnt || ''} → *${o.datos.plan || ''}* (${soles(o.datos.tarifa)})`);
  if (o.tipo === 'ORDEN_SERVICIO') { const d = o.datos || {}; l.push(`\nTrabajo: *${d.trabajo || ''}*${d.motivo ? ' — ' + d.motivo : ''}`, `Fecha: ${txtFecha(d.fecha)}${d.hora ? ' ' + d.hora : ''}${d.tecnico ? ' · Técnico: ' + d.tecnico : ''}`);
    if (Number(d.cobrar) > 0) l.push(`Cobrar: ${soles(d.cobrar)}`); }
  return l.join('\n');
}

/** Descarga el documento como archivo .html (se abre sin internet en cualquier navegador). */
async function descargarDocumento(o) {
  const txt = async (u) => { try { return await (await fetch(u)).text(); } catch (e) { return ''; } };
  let logo = 'icons/icono-192.png';
  try {
    const b = await (await fetch(logo)).blob();
    logo = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
  } catch (e) { /* sin logo */ }
  const css = (await txt('css/tokens.css')) + '\n' + (await txt('css/estilos.css'));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(OT_TITULO[o.tipo])} ${esc(o.id)}</title><style>${css}\nbody{background:#fff;padding:16px}.no-imprimir{display:none!important}</style></head>
    <body>${htmlDocumento(o, logo)}</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${({ RUTA_CORTE: 'HojaRuta', ORDEN_CORTE: 'OrdenCorte' })[o.tipo] || 'OrdenTrabajo'}_${o.id}_${String(o.fecha).slice(0, 10)}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- DOCUMENTO: ver, imprimir / guardar PDF, compartir, descargar, marcar ---------------------
async function vOrden(ref) {
  const o = (await ordenesLocales()).find((x) => x.ref === ref || x.id === ref || x.solicitud === ref);
  if (!o) { vista().innerHTML = '<p class="error">Orden no encontrada. Sincronice e intente de nuevo.</p><a class="btn" href="#/ordenes">Volver</a>'; return; }
  const refEnvio = o.local ? o.solicitud : o.id;
  vista().innerHTML = `<div class="no-imprimir barra-doc">
      <a class="mini" href="#/ordenes">${ic('atras')}Registro</a>
      <button class="mini" id="dImprimir">${ic('descargar')}Imprimir / PDF</button>
      <button class="mini" id="dCompartir">${ic('compartir')}Compartir</button>
      <button class="mini" id="dDescargar">${ic('documento')}Descargar</button>
      ${o.estado === 'Pendiente' ? `<a class="mini" href="${esc(enlaceCalendario(o))}" target="_blank" rel="noopener">${ic('calendario')}Calendario</a>` : ''}
      ${o.estado === 'Pendiente' ? `<button class="mini rojo" id="dAnular">${ic('anular')}Anular</button>` : ''}
    </div>
    ${o.local ? '<p class="aviso no-imprimir">Orden sin enviar: el N° definitivo llegará al sincronizar. Ya puede imprimirla y trabajar con ella.</p>' : ''}
    ${o.sinEnviar ? '<p class="aviso no-imprimir">Hay marcas sin enviar en esta orden.</p>' : ''}
    ${htmlDocumento(o)}
    ${(o.tipo === 'CAMBIO_PLAN' || o.tipo === 'ORDEN_SERVICIO') && o.items[0] && o.items[0].estado === 'Pendiente' && o.estado === 'Pendiente' ? `<section class="no-imprimir form cierre-ot">
      <h3>${o.tipo === 'ORDEN_SERVICIO' ? 'Cerrar la orden' : 'Completar instalación'}</h3>
      <label>${o.tipo === 'ORDEN_SERVICIO' ? 'Fecha del trabajo' : 'Fecha de instalación'}<input id="dFecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
      <button class="btn grande verde" id="dCompletar">${ic('check')}${o.tipo === 'ORDEN_SERVICIO' ? 'Trabajo hecho' : 'Marcar como completada'}</button>
      <button class="btn" id="dNoEjec">${o.tipo === 'ORDEN_SERVICIO' ? 'No se pudo hacer' : 'No se pudo instalar'}</button></section>` : ''}`;
  // acciones por cliente en la hoja de ruta (no se imprimen)
  vista().querySelectorAll('.acc-item').forEach((div) => {
    const it = o.items.find((x) => x.idServ === div.dataset.serv), r = D.resumen[it.idCliente] || {};
    if (it.estado !== 'Pendiente' || o.estado !== 'Pendiente') { div.remove(); return; }
    if (o.tipo === 'ORDEN_LIBRE') {           // tareas: Hecho / No se pudo (sin corte ni ficha)
      div.innerHTML = `<button class="mini verde" data-r="EJECUTADO">${ic('check')}Hecho</button><button class="mini" data-r="NO_EJECUTADO">No se pudo</button>`;
      div.querySelectorAll('[data-r]').forEach((b) => { b.onclick = async () => {
        let motivo = '';
        if (b.dataset.r === 'NO_EJECUTADO') {
          const m = await pedirTexto('¿Por qué no se pudo?', { titulo: it.snap.tarea, si: 'Guardar' });
          if (m === null) return;
          motivo = m.trim();
          if (motivo.length < 3) return aviso('Escriba el motivo.', 'error');
        }
        await encolar({ tipo: 'CERRAR_ITEM_ORDEN', idServ: it.idServ, fecha: hoyISO(), motivo, datos: { ref: refEnvio, resultado: b.dataset.r } });
        aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
        vOrden(ref);
      }; });
      return;
    }
    const pagó = Number(r.DEUDA_VENCIDA) === 0 && Number(it.snap.deuda) > 0;
    div.innerHTML = `${pagó ? '<p class="aviso">Ya no tiene deuda vencida: probablemente pagó.</p>' : ''}
      <button class="mini rojo" data-r="EJECUTADO">${ic('cortar')}Cortado</button><button class="mini" data-r="NO_EJECUTADO">No cortado</button>
      <a class="mini" href="#/cliente/${esc(it.idCliente)}">Ficha</a>`;
    div.querySelectorAll('[data-r]').forEach((b) => { b.onclick = async () => {
      let motivo = '';
      if (b.dataset.r === 'EJECUTADO') {
        if (!(await confirmar(`${it.snap.n} (${it.idServ})\nSe registra el corte con fecha de hoy y se libera el PPPoE.`, { titulo: '¿Cortado?', si: 'Sí, cortado', peligro: true }))) return;
      } else {
        const m = await pedirTexto('¿Por qué no se cortó? (ej.: pagó, no estaba, sin acceso)', { titulo: it.snap.n, si: 'Guardar', valor: pagó ? 'Pagó' : '' });
        if (m === null) return;
        motivo = m.trim();
        if (motivo.length < 3) return aviso('Escriba el motivo.', 'error');
      }
      await encolar({ tipo: 'CERRAR_ITEM_ORDEN', idServ: it.idServ, idCliente: it.idCliente, fecha: hoyISO(), motivo, datos: { ref: refEnvio, resultado: b.dataset.r } });
      aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
      vOrden(ref);
    }; });
  });
  $('#dImprimir').onclick = () => window.print();
  $('#dDescargar').onclick = () => descargarDocumento(o);
  $('#dCompartir').onclick = async () => {
    const texto = textoOrden(o);
    if (navigator.share) { try { await navigator.share({ title: OT_TITULO[o.tipo] + ' ' + o.id, text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
  };
  if ($('#dAnular')) $('#dAnular').onclick = async () => {
    const m = await pedirTexto('Motivo de la anulación (los clientes pendientes no se tocan):', { titulo: `Anular ${o.id}`, si: 'Anular', peligro: true });
    if (m === null) return;
    if (m.trim().length < 3) return aviso('Escriba el motivo.', 'error');
    await encolar({ tipo: 'ANULAR_ORDEN', motivo: m.trim(), datos: { ref: refEnvio } });
    aviso(navigator.onLine ? 'Anulación enviada.' : 'Guardada: se enviará al volver la señal.');
    vOrden(ref);
  };
  if ($('#dCompletar')) {
    const it = o.items[0];
    $('#dCompletar').onclick = async () => {
      const fe = $('#dFecha').value || hoyISO();
      const os = o.tipo === 'ORDEN_SERVICIO';
      if (!(await confirmar(os ? `${it.snap.n}\n${o.datos.trabajo || ''}\nHecho el ${txtFecha(fe)}.`
        : `${it.snap.n}\n${o.datos.planAnt || ''} → ${o.datos.plan} (${soles(o.datos.tarifa)})\nInstalado el ${txtFecha(fe)}: se aplica el cambio con prorrateo.`,
        { titulo: os ? '¿Trabajo hecho?' : '¿Instalación completada?', si: os ? 'Sí, hecho' : 'Completar' }))) return;
      await encolar({ tipo: 'CERRAR_ITEM_ORDEN', idServ: it.idServ, idCliente: it.idCliente, fecha: fe, motivo: '', datos: { ref: refEnvio, resultado: 'EJECUTADO' } });
      aviso(navigator.onLine ? (os ? 'Enviado.' : 'Enviado: el plan se actualizará en segundos.') : 'Guardado: se enviará al volver la señal.');
      vOrden(ref);
    };
    $('#dNoEjec').onclick = async () => {
      const m = await pedirTexto(o.tipo === 'ORDEN_SERVICIO' ? '¿Por qué no se pudo hacer?' : '¿Por qué no se pudo instalar?', { titulo: it.snap.n, si: 'Guardar' });
      if (m === null) return;
      if (m.trim().length < 3) return aviso('Escriba el motivo.', 'error');
      await encolar({ tipo: 'CERRAR_ITEM_ORDEN', idServ: it.idServ, idCliente: it.idCliente, fecha: hoyISO(), motivo: m.trim(), datos: { ref: refEnvio, resultado: 'NO_EJECUTADO' } });
      aviso(o.tipo === 'ORDEN_SERVICIO' ? 'Guardado. La orden queda cerrada.' : 'Guardado. La orden queda cerrada sin cambiar el plan.');
      vOrden(ref);
    };
  }
}

// ---- RECORDATORIOS: avisos en este celular + calendario compartido de Google --------------------
const avisosSoportados = () => 'Notification' in window && 'serviceWorker' in navigator;

/**
 * AVISOS PERSISTENTES DE PENDIENTES (desde la 1.25.0): las órdenes de hoy Y las atrasadas avisan cada día
 * hasta que se completen. Modo "una por orden" (Android las agrupa en un solo bloque que se despliega)
 * o "un solo aviso" con la lista. Los avisos no se borran solos (requireInteraction); al completarse
 * una orden, su aviso se quita en la siguiente sincronización.
 */
const MAX_AVISOS_SUELTOS = 8;     // con más pendientes, un solo aviso con la lista (no llenar la bandeja)
const lineaAviso = (o, hoy) => {
  const f = fechaOrden(o), atraso = f && f < hoy ? Math.round((new Date(hoy) - new Date(f)) / 864e5) : 0;
  return `${atraso ? `ATRASADA ${atraso} día${atraso > 1 ? 's' : ''}` : 'HOY' + ((o.datos && o.datos.hora) ? ' ' + o.datos.hora : '')} · ${OT_NOMBRE[o.tipo] || o.tipo}${zonaOrden(o) ? ' · ' + zonaOrden(o) : ''}`;
};
async function avisarPendientes(pend) {
  try {
    if (!avisosSoportados() || Notification.permission !== 'granted' || !(await kvGet('avisosOt'))) return;
    const reg = await navigator.serviceWorker.ready, hoy = hoyISO();
    const modo = (await kvGet('avisosModo')) || 'orden', sueltos = modo === 'orden' && pend.length <= MAX_AVISOS_SUELTOS;
    const previos = (await kvGet('avisosMostrados')) || {};        // tag → día en que se mostró
    const vivos = {};
    const base = { icon: 'icons/icono-192.png', badge: 'icons/favicon-32.png', requireInteraction: true, lang: 'es' };
    if (sueltos) {
      for (const o of pend) {
        const tag = 'ot-' + o.ref, nuevo = previos[tag] !== hoy;
        vivos[tag] = hoy;
        if (!nuevo) continue;                                        // ya avisó hoy: no repetir
        await reg.showNotification(`${OT_NOMBRE[o.tipo] || 'Orden'} pendiente`, Object.assign({}, base, {
          body: lineaAviso(o, hoy) + (o.detalle ? '\n' + o.detalle : ''), tag, renotify: true,
          data: { url: '#/orden/' + encodeURIComponent(o.ref) } }));
      }
    } else if (pend.length) {
      const tag = 'ordenes-pend', firma = hoy + ':' + pend.map((o) => o.ref).sort().join(',');
      vivos[tag] = firma;
      if (previos[tag] !== firma) {
        const lineas = pend.slice(0, 6).map((o) => lineaAviso(o, hoy));
        await reg.showNotification(`${pend.length} pendiente(s) por hacer`, Object.assign({}, base, {
          body: lineas.join('\n') + (pend.length > 6 ? `\n+${pend.length - 6} más · toque para ver por zona` : ''), tag, renotify: true,
          data: { url: '#/ordenes' } }));
      }
    }
    // se quitan los avisos de lo que ya se hizo (o del otro modo)
    for (const n of await reg.getNotifications()) if ((/^ot-/.test(n.tag) || n.tag === 'ordenes-pend' || n.tag === 'ordenes-hoy') && !vivos[n.tag]) n.close();
    await kvSet('avisosMostrados', vivos);
  } catch (e) { /* sin avisos: no pasa nada */ }
}
/** Después de cada sincronización (y al abrir): órdenes pendientes de hoy y atrasadas. */
async function revisarAvisos() {
  const hoy = hoyISO();
  avisarPendientes((await ordenesLocales()).filter((o) => o.estado === 'Pendiente' && fechaOrden(o) && fechaOrden(o) <= hoy)
    .sort((a, b) => fechaOrden(a).localeCompare(fechaOrden(b))));
}

async function vRecordatorios() {
  const soporta = avisosSoportados(), perm = soporta ? Notification.permission : 'no', activo = !!(await kvGet('avisosOt'));
  const estado = !soporta ? ['gris', 'Este celular no permite avisos de la app.'] : perm === 'denied' ? ['rojo', 'Bloqueados: actívelos en Ajustes del celular → Apps → Chrome → Notificaciones.']
    : perm === 'granted' && activo ? ['verde', 'Activos: cada día le avisaremos de las órdenes de hoy y las atrasadas, hasta que se completen.'] : ['ambar', 'Desactivados.'];
  const modo = (await kvGet('avisosModo')) || 'orden';
  vista().innerHTML = `<section class="form"><a class="volver" href="#/perfil">${ic('atras')}Perfil</a>
    <h2 class="tit-ic">${ic('campana')}Recordatorios</h2>
    <div class="tarjeta-form"><h3 class="tit-ic">${ic('celular')}Avisos en este celular ${ayuda('Avisos de la app', 'La app avisa de las órdenes y hojas de ruta de HOY y de las ATRASADAS, una vez al día, hasta que se marquen como hechas. El aviso queda en la bandeja hasta que lo toque o lo deslice.\nSe revisa al abrir la app y en cada sincronización (cada 3 minutos con la app abierta).\nCon la app cerrada no puede avisar: para eso está el calendario de Google (abajo), que repite el aviso cada día.')}</h3>
      <p class="estado-aviso c-${estado[0]}">${esc(estado[1])}</p>
      ${perm === 'granted' && activo ? `<div class="modo-avisos" role="group" aria-label="Cómo avisar">
        <button type="button" class="tarjeta-accion ${modo === 'orden' ? 'sel' : ''}" data-modo="orden" aria-pressed="${modo === 'orden'}"><span class="ta-ic c-azul">${ic('lista')}</span><span class="ta-txt"><b>Uno por orden</b><small>El celular los junta en un bloque que se despliega (hasta ${MAX_AVISOS_SUELTOS}; con más, uno solo)</small></span></button>
        <button type="button" class="tarjeta-accion ${modo === 'uno' ? 'sel' : ''}" data-modo="uno" aria-pressed="${modo === 'uno'}"><span class="ta-ic c-violeta">${ic('campana')}</span><span class="ta-txt"><b>Un solo aviso</b><small>Con la lista de pendientes</small></span></button></div>` : ''}
      ${soporta && perm !== 'denied' ? `<button class="btn ${activo && perm === 'granted' ? '' : 'verde'}" id="rcAct">${ic('campana')}${activo && perm === 'granted' ? 'Desactivar avisos' : 'Activar avisos'}</button>` : ''}
      ${soporta && perm === 'granted' ? `<button class="btn secundario" id="rcProbar">Probar un aviso</button>` : ''}</div>
    <div class="tarjeta-form"><h3 class="tit-ic">${ic('calendario')}Calendario de Google ${ayuda('Calendario compartido', 'Cada orden nueva aparece en el calendario "D@NDINET Órdenes" con avisos 1 hora y 15 minutos antes (si no tiene hora, a las 8:00).\nSe REPITE CADA DÍA mientras siga pendiente (hasta 30 días) y avisa aunque la app esté cerrada.\nAl completar o anular, deja de repetirse y se marca [HECHO] o [ANULADA].')}</h3>
      <ol class="pasos-texto">
        <li><b>Dueño, una sola vez:</b> en la PC abra el proyecto de Apps Script y ejecute <code>autorizarCalendario</code> (acepte los permisos).</li>
        <li><b>Compartir:</b> en Google Calendar, junto a "D@NDINET Órdenes" toque ⋮ → <i>Configuración y uso compartido</i> → <i>Compartir con determinadas personas</i> → agregue el Gmail de cada técnico.</li>
        <li><b>Cada técnico:</b> acepta la invitación y en la app Google Calendar activa ese calendario y sus notificaciones.</li></ol>
      <p class="sub">También puede agregar una orden suelta a su calendario con el botón <b>Calendario</b> dentro de cada orden.</p></div></section>`;
  if ($('#rcAct')) $('#rcAct').onclick = async () => {
    if (activo && perm === 'granted') { await kvSet('avisosOt', false); aviso('Avisos desactivados.'); return vRecordatorios(); }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { aviso('Sin permiso del celular no se pueden mostrar avisos.', 'error'); return vRecordatorios(); }
    await kvSet('avisosOt', true); await kvSet('avisosMostrados', {});
    aviso('Avisos activados.');
    revisarAvisos();
    vRecordatorios();
  };
  vista().querySelectorAll('[data-modo]').forEach((b) => { b.onclick = async () => {
    await kvSet('avisosModo', b.dataset.modo); await kvSet('avisosMostrados', {});
    aviso(b.dataset.modo === 'orden' ? 'Un aviso por cada orden pendiente.' : 'Un solo aviso con la lista.');
    revisarAvisos(); vRecordatorios();
  }; });
  if ($('#rcProbar')) $('#rcProbar').onclick = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('D@NDINET · prueba', { body: 'Así se verán los avisos de órdenes.', icon: 'icons/icono-192.png', tag: 'prueba', data: { url: '#/recordatorios' } });
  };
}

/** Enlace "Agregar a Google Calendar" para una orden (sin permisos ni configuración). */
function enlaceCalendario(o) {
  const d = o.datos || {}, dia = fechaOrden(o).replace(/-/g, ''), hm = /^(\d{1,2}):(\d{2})/.exec(d.hora || '') || [null, '08', '00'];
  const ini = `${dia}T${String(hm[1]).padStart(2, '0')}${hm[2]}00`, h2 = String(Number(hm[1]) + 1).padStart(2, '0');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: `${OT_NOMBRE[o.tipo] || 'Orden'} ${o.id}${zonaOrden(o) ? ' · ' + zonaOrden(o) : ''}`,
    dates: `${ini}/${dia}T${h2}${hm[2]}00`, ctz: 'America/Lima', details: `${o.detalle || ''}\n${location.origin}${location.pathname}#/orden/${o.ref}` });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

// ---- REPORTE DE MOVIMIENTOS (mes y año, tipo, zona) -------------------------------------------
async function vMovimientos() {
  const hoy = hoyISO(), f = Object.assign({ anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)), tipo: '', zona: '' }, (await kvGet('filtrosMov')) || {});
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  const tipos = ['Corte', 'Suspensión', 'Pausa vacacional', 'Cambio de plan', 'Reactivación', 'Baja', 'Alta', 'Renovación', 'Orden de trabajo', 'Orden de corte', 'Hoja de ruta', 'Otro'];
  const zonas = [...new Set(D.clientes.map((c) => c.ZONA).filter(Boolean))].sort();
  const a0 = Number(hoy.slice(0, 4));
  vista().innerHTML = `<h2>Reporte de movimientos</h2>
    <div class="filtros no-imprimir">
      <label>Año<select id="mA">${[a0 - 2, a0 - 1, a0].map((a) => opt(a, a, f.anio)).join('')}</select></label>
      <label>Mes<select id="mM">${opt(0, 'Todo el año', f.mes)}${MESES_TXT.map((m, i) => opt(i + 1, m, f.mes)).join('')}</select></label>
      <label>Tipo<select id="mT">${opt('', 'Todos', f.tipo)}${tipos.map((t) => opt(t, t, f.tipo)).join('')}</select></label>
      <label>Zona<select id="mZ">${opt('', 'Todas', f.zona)}${zonas.map((z) => opt(z, z, f.zona)).join('')}</select></label>
    </div>
    <button class="btn no-imprimir" id="mImprimir">${ic('descargar')}Imprimir / PDF</button>
    <div id="mRes"><p class="aviso">Cargando…</p></div>`;
  const pintar = (d, cache) => {
    const per = (d.filtros.mes ? MESES_TXT[d.filtros.mes - 1] + ' ' : '') + d.filtros.anio;
    $('#mRes').innerHTML = `<p class="sub">${esc(per)}${d.filtros.tipo ? ' · ' + esc(d.filtros.tipo) : ''}${d.filtros.zona ? ' · ' + esc(d.filtros.zona) : ''} ·
        ${d.total} movimiento(s)${cache ? ' (guardado, actualizando…)' : ''}${d.recortado ? ' · se muestran los 1500 más recientes' : ''}</p>
      <div class="chips no-imprimir">${Object.entries(d.resumen).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
        `<button class="mini ${t === d.filtros.tipo ? 'sel' : ''}" data-tipo="${esc(t)}">${esc(t)} (${n})</button>`).join('')}</div>
      <ul class="lista">${d.filas.map((x) => `<li><a href="#/cliente/${esc(x.id)}"><div><b>${esc(x.cliente)}</b>
        <small>${esc(txtFecha(x.fecha))} · ${esc(x.id)}${x.serv ? ' · ' + esc(x.serv) : ''} · ${esc(x.zona)}</small><small>${esc(x.detalle)}</small></div>
        <div class="der"><span class="chip ${({ Corte: 'e-moroso', Baja: 'e-baja', Suspensión: 'e-susp', 'Pausa vacacional': 'e-susp', Reactivación: 'e-activo', Alta: 'e-activo' })[x.tipo] || 'e-pend'}">${esc(x.tipo)}</span></div></a></li>`).join('')
        || '<li class="vacio">Sin movimientos con estos filtros.</li>'}</ul>`;
    $('#mRes').querySelectorAll('[data-tipo]').forEach((b) => { b.onclick = () => { $('#mT').value = b.dataset.tipo === d.filtros.tipo ? '' : b.dataset.tipo; cargar(); }; });
  };
  const cargar = async () => {
    Object.assign(f, { anio: Number($('#mA').value), mes: Number($('#mM').value), tipo: $('#mT').value, zona: $('#mZ').value });
    await kvSet('filtrosMov', f);
    const clave = 'mov_' + JSON.stringify(f), guardado = await kvGet(clave);
    if (guardado) pintar(guardado, true);
    if (!navigator.onLine) { if (!guardado) $('#mRes').innerHTML = '<p class="aviso">Sin señal: el reporte necesita conexión (se guarda el último consultado).</p>'; return; }
    try {
      const d = await llamar('movimientos', { filtros: f });
      await kvSet(clave, d);
      if (location.hash.startsWith('#/movimientos')) pintar(d, false);
    } catch (e) { if (!guardado) $('#mRes').innerHTML = `<p class="aviso error">${esc(e.message)}</p>`; }
  };
  ['#mA', '#mM', '#mT', '#mZ'].forEach((x) => { $(x).onchange = cargar; });
  $('#mImprimir').onclick = () => window.print();
  cargar();
}

// ---- DATOS DEL NEGOCIO Y MENSAJES (editables por el administrador) --------------------------
const CAMPOS_NEGOCIO = [
  ['Negocio', 'Nombre del negocio', 'text'], ['RUC', 'RUC (11 dígitos)', 'numeric'], ['Direccion', 'Dirección', 'text'],
  ['Telefono', 'Celular del negocio', 'numeric'], ['Email', 'Correo', 'email'],
];
const CAMPOS_COBRO = [['Yape', 'N° Yape', 'numeric'], ['TitularCobro', 'Titular de las cuentas', 'text'], ['BCP', 'Cuenta BCP', 'numeric'], ['BN', 'Cuenta Banco de la Nación', 'numeric']];
const MENSAJES = [
  ['MsgCobranza', 'Recordatorio de pago (WhatsApp)'], ['MsgCorte', 'Aviso de corte (WhatsApp)'], ['MensajeRecibo', 'Mensaje al pie del recibo'],
];
const VARIABLES = [['{NOMBRE}', 'nombre'], ['{DEUDA}', 'deuda'], ['{MESES}', 'meses'], ['{PERIODOS}', 'meses que debe'], ['{DIA}', 'día de pago'],
  ['{YAPE}', 'Yape'], ['{TITULAR}', 'titular'], ['{BCP}', 'BCP'], ['{BN}', 'B. Nación'], ['{NEGOCIO}', 'negocio']];

function vNegocio(sec) {
  const cfg = D.config, txt = (k) => String(cfg[k] || '').replace(/\\n/g, '\n');
  const campo = ([k, etq, tipo]) => `<label>${esc(etq)}<input data-k="${k}" value="${esc(txt(k))}" ${tipo === 'numeric' ? 'inputmode="numeric"' : tipo === 'email' ? 'type="email"' : ''} autocomplete="off"></label>`;
  // cliente de ejemplo para la vista previa: el primero con deuda
  const ej = Object.values(D.resumen).find((r) => Number(r.DEUDA_VENCIDA) > 0) || Object.values(D.resumen)[0] || {};
  const ver = (k) => !sec || sec === k;
  const TIT = { datos: ['documento', 'Datos del negocio', 'Salen en los recibos, órdenes y hojas de ruta.'],
    cobro: ['cobrar', 'Cuentas de cobro', 'Salen en el recibo (con el logo de cada banco) y en los mensajes.'],
    mensajes: ['chat', 'Mensajes de WhatsApp', 'Toque una variable para insertarla donde está el cursor: se reemplaza por el dato de cada cliente.'] };
  const t = TIT[sec] || ['ajustes', 'Datos del negocio y mensajes', 'Salen en los recibos, órdenes y mensajes.'];
  vista().innerHTML = `<section class="form"><a class="volver" href="#/perfil">${ic('atras')}Perfil</a>
    <h2 class="tit-ic">${ic(t[0])}${esc(t[1])} ${ayuda(t[1], t[2] + '\nLos cambios se aplican al sincronizar.')}</h2>
    ${ver('datos') ? `<div class="tarjeta-form">${CAMPOS_NEGOCIO.map(campo).join('')}</div>` : ''}
    ${ver('cobro') ? `<div class="tarjeta-form cuentas-cobro">${CAMPOS_COBRO.map((x) => `<div class="cuenta-banco">${/yape/i.test(x[0]) ? '<img src="icons/bancos/yape-ico.png" alt="" width="40" height="40">'
      : x[0] === 'BCP' ? '<img src="icons/bancos/bcp-ico.png" alt="" width="40" height="40">' : x[0] === 'BN' ? '<img src="icons/bancos/bn-ico.png" alt="" width="40" height="40">'
      : `<span class="ico-metodo">${ic('usuario')}</span>`}${campo(x)}</div>`).join('')}</div>` : ''}
    ${!ver('mensajes') ? '' : MENSAJES.map(([k, etq]) => `<label>${esc(etq)}<textarea data-k="${k}" rows="${k === 'MensajeRecibo' ? 2 : 7}">${esc(txt(k))}</textarea></label>
      ${k !== 'MensajeRecibo' ? `<div class="chips vars">${VARIABLES.map(([v, d]) => `<button type="button" class="mini" data-var="${v}" data-para="${k}" title="${esc(d)}">${v}</button>`).join('')}</div>
      <details class="previa"><summary>Vista previa con ${esc(ej.NOMBRES || 'un cliente')}</summary><pre data-previa="${k}"></pre></details>` : ''}`).join('')}
    <button class="btn grande verde" id="ok">${ic('check')}Guardar cambios</button>
    <a class="btn secundario" href="#/perfil">Cancelar</a></section>`;
  const valor = (k) => (vista().querySelector(`[data-k="${k}"]`) || {}).value || '';
  const previa = () => vista().querySelectorAll('[data-previa]').forEach((pre) => {
    const k = pre.dataset.previa, guard = cfg[k];
    const temp = Object.assign({}, cfg); CAMPOS_COBRO.concat(CAMPOS_NEGOCIO).forEach(([c]) => { temp[c] = valor(c); });
    D.config = Object.assign({}, temp, { [k]: valor(k) });
    pre.textContent = plantilla(k, ej.ID_CLIENTE);
    D.config = cfg; cfg[k] = guard;
  });
  vista().querySelectorAll('[data-k]').forEach((el) => { el.oninput = previa; });
  vista().querySelectorAll('[data-var]').forEach((b) => { b.onclick = () => {
    const ta = vista().querySelector(`[data-k="${b.dataset.para}"]`), ini = ta.selectionStart ?? ta.value.length, fin = ta.selectionEnd ?? ini;
    ta.value = ta.value.slice(0, ini) + b.dataset.var + ta.value.slice(fin);
    ta.focus(); ta.selectionStart = ta.selectionEnd = ini + b.dataset.var.length; previa();
  }; });
  previa();
  $('#ok').onclick = async () => {
    const valores = {};
    // solo los campos de la sección abierta (los que no están en pantalla no se tocan)
    CAMPOS_NEGOCIO.concat(CAMPOS_COBRO).concat(MENSAJES).forEach(([k]) => { if (!vista().querySelector(`[data-k="${k}"]`)) return;
      const v = valor(k).trim(); if (v !== txt(k).trim()) valores[k] = v; });
    if (!Object.keys(valores).length) return aviso('No hay cambios.');
    // mismas validaciones que el servidor
    if ('RUC' in valores && valores.RUC && !/^(10|15|17|20)\d{9}$/.test(valores.RUC)) return aviso('RUC: 11 dígitos que empiecen con 10, 15, 17 o 20.', 'error');
    for (const k of ['Telefono', 'Yape']) if (k in valores && valores[k] && !/^9\d{8}$/.test(valores[k])) return aviso('Celular: 9 dígitos que empiecen con 9.', 'error');
    if ('Email' in valores && valores.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valores.Email)) return aviso('Correo inválido.', 'error');
    if (!(await confirmar(Object.keys(valores).join(', '), { titulo: '¿Guardar estos cambios?', si: 'Guardar' }))) return;
    await encolar({ tipo: 'GUARDAR_CONFIG', datos: { valores } });
    Object.assign(D.config, valores);
    aviso(navigator.onLine ? 'Guardado. Los recibos nuevos ya salen con estos datos.' : 'Guardado: se enviará al volver la señal.');
    location.hash = '#/perfil';
  };
}

function vAsignarPPPoE(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  const disp = pppoeDisponibles();
  vista().innerHTML = `<section class="form"><h2>Asignar PPPoE</h2><p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.PLAN)}</p>
    ${esCatv(s) ? `<p class="aviso error">${ic('tv')}<span>Este es el servicio de CATV (cable): no lleva PPPoE. Asígnelo al servicio de INTERNET del cliente.</span></p>`
      : disp.length ? `${campoPPPoE('ppp', '', { titulo: 'PPPoE del internet', paraQuien: s.CLIENTE })}
    <button class="btn grande verde" id="ok">ASIGNAR</button>` : '<p class="aviso">No hay códigos disponibles. Agregue uno en PPPoE.</p>'}
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  if (disp.length && !esCatv(s)) $('#ok').onclick = async () => {
    if (!$('#ppp').value) return aviso('Elija un código PPPoE.', 'error');
    await encolar({ tipo: 'ASIGNAR_PPPOE', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, codigoPPPoE: $('#ppp').value, fecha: hoyISO() });
    aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

// ---- DASHBOARD -----------------------------------------------------------------------
const MESES_TXT = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];

async function vDashboard() {
  const hoy = hoyISO(), anioHoy = Number(hoy.slice(0, 4)), mesHoy = Number(hoy.slice(5, 7));
  const f = (await kvGet('dashFiltros')) || { anio: anioHoy, mes: mesHoy, zona: '', plan: '' };
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  vista().innerHTML = `<h2>Dashboard</h2>
    <div class="filtros">
      <select id="dA" aria-label="Año">${[anioHoy - 2, anioHoy - 1, anioHoy, anioHoy + 1].map((a) => opt(a, a, f.anio)).join('')}</select>
      <select id="dM" aria-label="Mes">${MESES_TXT.map((m, i) => opt(i + 1, m, f.mes)).join('')}</select>
      <select id="dZ" aria-label="Zona">${opt('', 'Todas las zonas', f.zona)}${lst('ZONA').map((z) => opt(z, z, f.zona)).join('')}</select>
      <select id="dP" aria-label="Plan">${opt('', 'Todos los planes', f.plan)}${D.planes.map((p) => opt(p.PLAN, p.PLAN, f.plan)).join('')}</select>
    </div>
    <div id="dash"><p class="aviso">Cargando…</p></div>`;
  const leer = () => ({ anio: Number($('#dA').value), mes: Number($('#dM').value), zona: $('#dZ').value, plan: $('#dP').value });
  ['#dA', '#dM', '#dZ', '#dP'].forEach((s) => { $(s).onchange = () => cargarDashboard(leer()); });
  cargarDashboard(f);
}

async function cargarDashboard(f) {
  await kvSet('dashFiltros', f);
  const clave = 'dash_' + JSON.stringify(f);
  const guardado = await kvGet(clave);
  if (guardado) pintarDashboard(guardado, true);
  if (!navigator.onLine) { if (!guardado) $('#dash').innerHTML = '<p class="aviso">Sin señal: el dashboard necesita conexión.</p>'; return; }
  try {
    const d = await llamar('dashboard', { filtros: f });
    await kvSet(clave, d);
    if (location.hash.startsWith('#/dashboard')) pintarDashboard(d, false);
  } catch (e) {
    if (!guardado) $('#dash').innerHTML = `<p class="aviso error">${esc(e.message)}</p>`;
  }
}

function barras(items, campo, formato, clase = '') {
  const max = Math.max(1, ...items.map((x) => Number(x[campo]) || 0));
  return `<div class="barras">${items.map((x) => `<div class="barra-fila"><span class="et">${esc(x.etiqueta)}</span>
    <span class="barra"><i class="${clase}" style="width:${Math.round((Number(x[campo]) || 0) / max * 100)}%"></i></span>
    <span class="val">${esc(formato(x[campo]))}</span></div>`).join('')}</div>`;
}

function pintarDashboard(d, desdeCache) {
  const k = d.kpi, pct = (x) => (Number(x) || 0).toFixed(1) + '%';
  const avance = Math.max(0, Math.min(100, Number(k.pctCobranza) || 0));
  const dato = (t, v, c = '') => `<div class="${c}"><span>${esc(t)}</span><b>${typeof v === 'number' ? v : esc(v)}</b></div>`;
  const mesTxt = MESES_TXT[d.filtros.mes - 1] + ' ' + d.filtros.anio;
  $('#dash').innerHTML = `
    <p class="sub">${esc(mesTxt)}${d.filtros.zona ? ' · ' + esc(d.filtros.zona) : ''}${d.filtros.plan ? ' · ' + esc(d.filtros.plan) : ''} ·
      calculado ${esc(txtFecha(d.generado))} ${esc(String(d.generado).slice(11, 16))}${desdeCache ? ' (guardado, actualizando…)' : ''}</p>
    <section class="hero" aria-label="Recaudación del mes">
      <span class="eyebrow">Recaudado en ${esc(mesTxt)}</span>
      <span class="monto">${soles(k.recaudadoMes)}</span>
      <span class="de">Dinero recibido en el mes (incluye meses atrasados) · Año: ${soles(k.recaudadoAnio)}</span>
      <div class="progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(avance)}" aria-label="Cuotas del mes pagadas"><i style="width:${avance}%"></i></div>
      <div class="pie-hero"><span>Cuotas de ${esc(MESES_TXT[d.filtros.mes - 1])} pagadas: <b>${pct(k.pctCobranza)}</b></span><span>de ${soles(k.esperadoMes)}</span></div>
    </section>
    <section class="lista-datos" aria-label="Cartera">
      ${dato('Deuda vencida', soles(k.deudaVencida), 'rojo')}${dato('Por cobrar', soles(k.porCobrar), 'amarillo')}
      ${dato('Morosidad', pct(k.tasaMorosidad), 'amarillo')}${dato('Morosos', k.morosos, 'rojo')}
      ${dato('Activos', k.activos, 'verde')}${dato('Cortados / susp.', k.cortados + k.suspendidos)}
      ${dato('Altas del mes', k.altasMes)}${dato('Cortes / bajas del mes', k.cortesMes)}
    </section>
    <h3>Morosidad por antigüedad</h3>
    ${barras(d.antiguedad.map((x) => ({ etiqueta: `${x.tramo} (${x.clientes})`, v: x.monto })), 'v', soles, 'peligro')}
    <h3>Recaudado por mes · ${d.filtros.anio}</h3>
    ${barras(d.porMes.map((x) => ({ etiqueta: x.mes, v: x.recaudado })), 'v', (v) => soles(v).replace('.00', ''))}
    <table class="resumen"><thead><tr><th>Mes</th><th>Recaudado</th><th>Esperado</th><th>% cobrado</th></tr></thead><tbody>
      ${d.porMes.filter((x) => x.esperado || x.recaudado).map((x) => `<tr><td>${esc(x.mes)}</td><td>${soles(x.recaudado)}</td><td>${soles(x.esperado)}</td><td>${pct(x.pctCobrado)}</td></tr>`).join('')}
    </tbody></table>
    <h3>Por método de pago</h3>
    <table class="resumen"><thead><tr><th>Método</th><th>${esc(MESES_TXT[d.filtros.mes - 1])}</th><th>Año</th></tr></thead><tbody>
      ${d.porMetodo.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${soles(x.mes)}</td><td>${soles(x.anio)}</td></tr>`).join('') || '<tr><td colspan="3">Sin pagos</td></tr>'}</tbody></table>
    <h3>Por cobrador</h3>
    <table class="resumen"><thead><tr><th>Cobrador</th><th>${esc(MESES_TXT[d.filtros.mes - 1])}</th><th>Año</th></tr></thead><tbody>
      ${d.porCobrador.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${soles(x.mes)}</td><td>${soles(x.anio)}</td></tr>`).join('') || '<tr><td colspan="3">Sin pagos</td></tr>'}</tbody></table>
    <h3>Por zona</h3>
    <table class="resumen"><thead><tr><th>Zona</th><th>Recaudado año</th><th>Deuda vencida</th></tr></thead><tbody>
      ${d.porZona.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${soles(x.anio)}</td><td>${soles(x.deudaVencida)}</td></tr>`).join('')}</tbody></table>
    <h3>Ranking de deudores</h3>
    <ul class="lista">${d.ranking.map((c, i) => `<li><a href="#/cliente/${esc(c.id)}"><div><b>${i + 1}. ${esc(c.nombre)}</b>
      <small>${esc(c.id)} · ${esc(c.estado)} · ${c.meses} mes(es)</small></div><div class="der"><b class="error">${soles(c.deuda)}</b></div></a></li>`).join('') || '<li class="vacio">Sin deudores</li>'}</ul>
    <h3>Riesgo de corte</h3>
    <ul class="lista">${d.riesgo.map((c) => `<li><a href="#/cliente/${esc(c.id)}"><div><b>${esc(c.nombre)}</b>
      <small>${esc(txtMora(c.dias))} de atraso · ${soles(c.deuda)}</small></div><div class="der"><span class="chip ${c.situacion === 'A CORTAR' ? 'e-moroso' : 'e-porvencer'}">${esc(c.situacion)}</span></div></a></li>`).join('') || '<li class="vacio">Nadie en riesgo</li>'}</ul>`;
}

// ---- CUENTA ----------------------------------------------------------------------------
async function vCuenta() {
  const pend = (await pendientesDeEnvio()).length;
  vista().innerHTML = `<section class="form"><h2>Mi cuenta</h2>
    <div class="cuenta-perfil"><span class="avatar" aria-hidden="true">${esc(iniciales(PERFIL.nombre))}</span>
      <div><b>${esc(PERFIL.nombre)}</b><small>${esc(PERFIL.email)} · ${esc(PERFIL.rol)}</small></div></div>
    <p class="sub">Versión ${CONFIG.VERSION}. Datos del ${esc(txtFecha(D.generado))} ${esc(String(D.generado || '').slice(11, 16))}.</p>
    <h3>Apariencia</h3>
    <div class="tema" role="group" aria-label="Tema">${[['auto', 'Automático'], ['dia', 'Día (sol)'], ['noche', 'Noche']].map(([v, t]) =>
      `<button class="mini ${temaActual() === v ? 'sel' : ''}" data-tema="${v}" aria-pressed="${temaActual() === v}">${t}</button>`).join('')}</div>
    <p class="sub">"Día" usa más contraste para leer en la calle. "Automático" sigue la configuración del celular.</p>
    <button class="btn" id="btnSync">${ic('sync')}Sincronizar ahora</button>
    <button class="btn rojo" id="salir">${ic('salir')}Cerrar sesión</button>
    ${pend ? `<p class="aviso error">Tiene ${pend} operación(es) sin enviar. Sincronice antes de cerrar sesión.</p>` : ''}</section>`;
  $('#btnSync').onclick = sincronizarManual;
  vista().querySelectorAll('[data-tema]').forEach((b) => { b.onclick = () => { ponerTema(b.dataset.tema); vCuenta(); }; });
  $('#salir').onclick = async () => {
    if (pend && !(await confirmar(`Hay ${pend} operación(es) SIN ENVIAR que se perderían.`, { titulo: '¿Cerrar sesión de todos modos?', si: 'Cerrar sesión', peligro: true }))) return;
    if (!(await confirmar('Se borrarán los datos guardados en este celular.', { titulo: 'Cerrar sesión', si: 'Cerrar sesión', peligro: true }))) return;
    cerrarSesionGoogle();
    await borrarTodo();
    location.hash = '';
    location.reload();
  };
}

// ---- TEMA (Automático / Día / Noche) — se guarda solo en este celular ------------------
function temaActual() { try { return localStorage.getItem('tema') || 'auto'; } catch (e) { return 'auto'; } }
function ponerTema(t) {
  try { if (t === 'auto') localStorage.removeItem('tema'); else localStorage.setItem('tema', t); } catch (e) { /* sin almacenamiento */ }
  if (t === 'auto') delete document.documentElement.dataset.tema; else document.documentElement.dataset.tema = t;
  // color de la barra del celular
  const oscuro = t === 'noche' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', oscuro ? '#081a33' : '#0c2447'); });
}

window.addEventListener('DOMContentLoaded', arrancar);
