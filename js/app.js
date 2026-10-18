// APP D@NDINET — pantallas y navegación (#/ruta)
import { CONFIG } from './config.js';
import { kvGet, kvSet, colaTodos, borrarTodo } from './db.js';
import { iniciarGoogle, dibujarBoton, leerToken, cerrarSesionGoogle, googleDisponible } from './auth.js';
import { llamar } from './api.js';
import { encolar, sincronizarTodo, iniciarAutoSync, alCambiar, pendientesDeEnvio, siguienteProvisional } from './sync.js';
import {
  D, cargarDatosLocales, esc, soles, r2, txtPeriodo, txtFecha, hoyISO, metodosPago, buscarClientes, serviciosDe,
  cargosDe, repartir, pppoeDisponibles, plantilla, enlaceWhatsApp, claseEstado, txtMora, prorrateoPlan,
} from './datos.js';
import { ic, observarIconos } from './iconos.js';

const $ = (s, el = document) => el.querySelector(s);
const vista = () => $('#vista');
let PERFIL = null;
let sincronizando = false;
let RUTA = 'inicio';

// ============================================================================
// ARRANQUE
// ============================================================================
async function arrancar() {
  observarIconos();
  registrarServiceWorker();
  PERFIL = await kvGet('perfil');
  const hayDatos = await cargarDatosLocales();
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
  if (PERFIL) return;                       // renovación silenciosa del token
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
  el.innerHTML = `<span class="grupo"><span class="punto"></span>${navigator.onLine ? 'En línea' : 'Sin señal'}</span>` +
    (sincronizando ? `<span class="grupo">${ic('sync', 'girando')}Sincronizando</span>` : '') +
    (pend ? `<span class="pend">${pend} por enviar</span>` : '') +
    `<span class="tenue">Act. ${esc(hora)}</span>`;
  const ins = $('#insigniaCola');
  if (ins) { ins.hidden = !pend; ins.textContent = pend > 99 ? '99+' : pend; }
}

function alEventoSync(info) {
  if (info.tipo === 'libro') aviso('El sistema pasó al libro definitivo: se borraron los datos de prueba de este celular.');
  if (info.tipo === 'inicio') sincronizando = true;
  if (info.tipo === 'fin') { sincronizando = false; if (info.ok) refrescarSiCorresponde(); else manejarErrorSync(info.error); }
  pintarEstado();
  if (info.tipo === 'cola' && /^#\/(cola|hoy|inicio)?$/.test(location.hash || '#/')) refrescarSiCorresponde();
}

function manejarErrorSync(e) {
  if (e && e.codigo === 'AUTH') aviso('Su sesión venció. Toque "Sincronizar" para renovarla (o vuelva a iniciar sesión).', 'error');
  else if (e && e.codigo !== 'RED') aviso(e.message, 'error');
}

function refrescarSiCorresponde() {
  const h = location.hash || '#/';
  if (!/^#\/(cobrar|corte|reactivar|nuevo|editar|asignar|pppoe|config|plan|pausa|orden|negocio)/.test(h) && !$('#modal')) enrutar();   // no interrumpir un formulario
}

let _avisoT = null;
function aviso(msg, tipo = 'ok') {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast ' + tipo; el.hidden = false;
  clearTimeout(_avisoT); _avisoT = setTimeout(() => { el.hidden = true; }, 4500);
}

// ============================================================================
// RUTAS
// ============================================================================
function enrutar() {
  const [ruta, arg] = (location.hash.replace(/^#\//, '') || 'inicio').split('/');
  RUTA = ruta;
  document.querySelectorAll('nav.inferior a').forEach((a) => a.classList.toggle('activo', a.dataset.r === ruta));
  const v = { inicio: vInicio, buscar: vBuscar, cliente: vCliente, cobrar: vCobrar, recibo: vRecibo, cola: vCola,
    hoy: vHoy, cortar: vACortar, corte: vCorte, reactivar: vReactivar, cuenta: vCuenta, pago: vPago, plan: vCambiarPlan, pausa: vPausa, ordenes: vOrdenes, orden: vOrden, movimientos: vMovimientos, negocio: vNegocio,
    mas: vMas, dashboard: vDashboard, config: vConfig, nuevo: vFormCliente, editar: vFormCliente, pppoe: vPPPoE, asignar: vAsignarPPPoE }[ruta] || vInicio;
  window.scrollTo(0, 0);
  cerrarModal();
  Promise.resolve(v(decodeURIComponent(arg || ''))).catch((e) => { vista().innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}

// ---- INICIO ------------------------------------------------------------------------
async function vInicio() {
  const res = Object.values(D.resumen);
  const n = (f) => res.filter(f).length;
  const deuda = res.reduce((s, r) => s + Number(r.DEUDA_VENCIDA || 0), 0);
  const hoy = await cobrosDeHoy();
  const aCortar = n((r) => /CORTAR/.test(r.ALERTA || ''));
  ordenesLocales._cache = await ordenesLocales();
  const pend = (await pendientesDeEnvio()).length;
  const h = new Date().getHours();
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const fila = (href, icono, etq, extra = '') => `<li><a href="${href}">${ic(icono)}<span class="etq">${etq}</span>${extra}${ic('flecha', 'fin')}</a></li>`;
  vista().innerHTML = `
    <div class="saludo"><p class="eyebrow">${esc(txtFecha(hoyISO()))}</p><h1>${saludo}, ${esc(String(PERFIL.nombre).split(' ')[0])}</h1></div>
    <a class="cta" href="#/buscar">${ic('cobrar')}<span class="txt"><b>Cobrar</b><small>Buscar cliente y registrar un pago</small></span>${ic('flecha', 'fin')}</a>
    <section class="cifras" aria-label="Resumen">
      <div><span>Activos</span><b>${n((r) => r.ESTADO === 'Activo' || r.ESTADO === 'Moroso')}</b></div>
      <div class="peligro"><span>Morosos</span><b>${n((r) => r.ESTADO === 'Moroso')}</b></div>
      <div><span>Cortados</span><b>${n((r) => r.ESTADO === 'Cortado')}</b></div>
      <div class="ancho peligro"><span>Deuda vencida total</span><b>${soles(deuda)}</b></div>
      <div class="ancho ok"><span>Mis cobros de hoy · ${hoy.items.length} recibo(s)</span><b>${soles(hoy.total)}</b></div>
    </section>
    <ul class="menu">
      ${fila('#/cortar', 'cortar', 'Clientes a cortar', aCortar ? `<span class="cuenta alerta">${aCortar}</span>` : '')}
      ${fila('#/hoy', 'recibo', 'Mis cobros de hoy', `<span class="cuenta">${hoy.items.length}</span>`)}
      ${fila('#/cola', 'cola', 'Cola de envío', pend ? `<span class="cuenta alerta">${pend}</span>` : '')}
      ${fila('#/ordenes', 'documento', 'Órdenes y hojas de ruta', (() => { const n = (ordenesLocales._cache || []).filter((o) => o.estado === 'Pendiente').length; return n ? `<span class="cuenta alerta">${n} pend.</span>` : ''; })())}
      ${fila('#/dashboard', 'grafico', 'Dashboard')}
    </ul>
    <button class="btn secundario" id="btnSync">${ic('sync')}Sincronizar ahora</button>`;
  $('#btnSync').onclick = sincronizarManual;
}

async function sincronizarManual() {
  if (!navigator.onLine) return aviso('Sin señal: los cobros quedan guardados y se enviarán solos.', 'error');
  try { await sincronizarTodo(); aviso('Datos actualizados.'); } catch (e) { manejarErrorSync(e); }
}

// ---- BUSCAR ------------------------------------------------------------------------
function vBuscar() {
  vista().innerHTML = `<input id="q" class="buscador" type="search" placeholder="Nombre, DNI, PPPoE, teléfono o ID" autocomplete="off" autofocus>
    <ul id="res" class="lista"></ul>`;
  const pintar = () => {
    const q = $('#q').value;
    const lista = buscarClientes(q, q ? 80 : 40);
    $('#res').innerHTML = lista.map((c) => {
      const r = D.resumen[c.ID_CLIENTE] || {};
      return `<li><a href="#/cliente/${esc(c.ID_CLIENTE)}">
        <div><b>${esc(c.NOMBRES)}</b><small>${esc(c.ID_CLIENTE)} · ${esc(c.ZONA)}${r.PPPOE ? ' · PPPoE ' + esc(r.PPPOE) : ''}</small></div>
        <div class="der"><span class="chip ${claseEstado(r.ESTADO)}">${esc(r.ESTADO || '-')}</span><small>${Number(r.DEUDA_VENCIDA) > 0 ? soles(r.DEUDA_VENCIDA) : ''}</small></div>
      </a></li>`;
    }).join('') || '<li class="vacio">Sin resultados</li>';
  };
  $('#q').addEventListener('input', pintar);
  pintar();
}

// ---- FICHA DEL CLIENTE -------------------------------------------------------------
async function vCliente(id) {
  const c = D.porId[id];
  if (!c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const r = D.resumen[id] || {}, priv = D.privados[id] || {};
  const pagos = D.pagos.filter((p) => p.ID_CLIENTE === id).slice(-8).reverse();
  const enCola = (await colaTodos()).filter((o) => o.idCliente === id && o.estadoLocal !== 'ok' && o.estadoLocal !== 'rechazado');
  vista().innerHTML = `
    <section class="ficha">
      <h2>${esc(c.NOMBRES)}</h2>
      <p class="sub">${esc(id)} · DNI/RUC ${esc(c.DNI_RUC)} · <span class="chip ${claseEstado(r.ESTADO)}">${esc(r.ESTADO)}</span></p>
      <div class="deuda ${Number(r.DEUDA_VENCIDA) > 0 ? 'roja' : 'verde'}">
        <span>Deuda vencida</span><b>${soles(r.DEUDA_VENCIDA)}</b><small>${r.MESES_ADEUDA || 0} cuota(s) vencida(s) · ${Number(r.DIAS_ATRASO) > 0 ? txtMora(r.DIAS_ATRASO) + ' de atraso' : 'al día'}${r.ALERTA ? ' · ' + esc(r.ALERTA) : ''}</small>
      </div>
      ${enCola.length ? `<p class="aviso">${ic('reloj')}<span>${enCola.length} operación(es) de este cliente en cola de envío.</span></p>` : ''}
      <a class="btn grande verde" href="#/cobrar/${esc(id)}">${ic('cobrar')}Cobrar</a>
      <div class="botones">
        ${c.TELEFONO ? `<a class="btn" href="tel:${esc(c.TELEFONO)}">${ic('telefono')}Llamar</a>` : ''}
        <button class="btn" id="btnRecordatorio">${ic('chat')}Recordatorio</button>
        <a class="btn" href="#/editar/${esc(id)}">${ic('editar')}Editar</a>
      </div>
      <h3>Datos</h3>
      <dl>
        <dt>Teléfono</dt><dd>${esc(c.TELEFONO)}${c.TELEFONO2 ? ' / ' + esc(c.TELEFONO2) : ''}</dd>
        <dt>Dirección</dt><dd>${esc(c.DIRECCION)}${c.REFERENCIA ? ' (Ref.: ' + esc(c.REFERENCIA) + ')' : ''}</dd>
        <dt>Zona</dt><dd>${esc(c.ZONA)}</dd>
        ${c.COORDENADAS ? `<dt>Mapa</dt><dd><a href="https://maps.google.com/?q=${encodeURIComponent(c.COORDENADAS)}" target="_blank" rel="noopener">${ic('ubicacion')}${esc(c.COORDENADAS)}</a></dd>` : ''}
        <dt>Último pago</dt><dd>${esc(txtFecha(r.ULT_PAGO)) || '-'}</dd>
        ${priv.USUARIO_WIFI || priv.CLAVE_WIFI ? `<dt>WiFi</dt><dd>${esc(priv.USUARIO_WIFI)} / <span class="secreto">${esc(priv.CLAVE_WIFI)}</span></dd>` : ''}
        ${priv.USUARIO_ROUTER || priv.CLAVE_ROUTER ? `<dt>Router</dt><dd>${esc(priv.USUARIO_ROUTER)} / <span class="secreto">${esc(priv.CLAVE_ROUTER)}</span></dd>` : ''}
      </dl>
      <h3>Servicios</h3>
      ${serviciosDe(id).map((s) => `
        <div class="servicio">
          <div class="serv-cab"><div><b>${esc(s.PLAN)}</b><small>${esc(s.ID_SERV)} · ${esc(s.MODO)} · ${soles(s.TARIFA)}/mes · PPPoE ${esc(s.PPPOE || '-')}</small>
          ${pausaDe(s.ID_SERV) ? `<small class="pausa-info">${ic('reloj')}Pausa vacacional ${esc(txtFecha(pausaDe(s.ID_SERV).F_INICIO))} → ${esc(txtFecha(pausaDe(s.ID_SERV).F_FIN))} · ${pausaDe(s.ID_SERV).ESTADO === 'Activa' ? 'en curso' : 'programada'}</small>` : ''}</div>
          <span class="chip ${claseEstado(s.ESTADO)}">${esc(s.ESTADO)}</span></div>
          <div class="acc-serv">
          ${s.ESTADO === 'Activo' ? `<a class="mini" href="#/plan/${esc(s.ID_SERV)}">Cambiar plan</a>` : ''}
          ${s.ESTADO === 'Activo' && !pausaDe(s.ID_SERV) ? `<a class="mini" href="#/pausa/${esc(s.ID_SERV)}">Pausar</a>` : ''}
          ${pausaDe(s.ID_SERV) ? `<button class="mini verde" data-terminar="${esc(s.ID_SERV)}">${pausaDe(s.ID_SERV).ESTADO === 'Activa' ? 'Terminar pausa' : 'Cancelar pausa'}</button>` : ''}
          ${s.ESTADO === 'Activo' ? `<a class="mini rojo" href="#/corte/${esc(s.ID_SERV)}">Cortar</a>` : ''}
          ${s.ESTADO === 'Activo' && !s.PPPOE ? `<a class="mini" href="#/asignar/${esc(s.ID_SERV)}">Asignar PPPoE</a>` : ''}
          ${(s.ESTADO === 'Cortado' || s.ESTADO === 'Suspendido') && !pausaDe(s.ID_SERV) ? `<a class="mini verde" href="#/reactivar/${esc(s.ID_SERV)}">Reactivar</a>` : ''}</div>
        </div>`).join('') || '<p class="vacio">Sin servicios</p>'}
      ${bloqueRenovar(id, r)}
      <h3>Últimos pagos</h3>
      <ul class="lista compacta" id="listaPagos">${pagos.map((p) => `<li><div><b>${esc(p.N_RECIBO)}</b><small>${esc(txtFecha(p.FECHA))} · ${esc(p.METODO)} · ${esc(txtPeriodos(p.PERIODOS))}</small></div>
        <div class="der">${soles(p.MONTO)}${p.ESTADO === 'Anulado' ? '<small class="error">ANULADO</small>' : ''}
          <span class="acciones-pago"><button class="mini" data-pdf="${esc(p.N_RECIBO)}">${ic('documento')}PDF</button>${p.ESTADO !== 'Anulado' ? `<button class="mini rojo" data-anular="${esc(p.N_RECIBO)}">Anular</button>` : ''}</span></div></li>`).join('') || '<li class="vacio">Sin pagos recientes</li>'}</ul>
      <div id="zonaPdf"></div>
    </section>`;
  $('#btnRecordatorio').onclick = () => enviarWhatsApp(id, plantilla('MsgCobranza', id));
  vista().querySelectorAll('[data-terminar]').forEach((b) => { b.onclick = async () => {
    const pa = pausaDe(b.dataset.terminar), enCurso = pa.ESTADO === 'Activa';
    if (!(await confirmar(enCurso ? `El servicio vuelve a Activo hoy. Los días no usados (hasta el ${txtFecha(pa.F_FIN)}) se vuelven a cobrar.`
      : `Se cancela la pausa del ${txtFecha(pa.F_INICIO)} al ${txtFecha(pa.F_FIN)} y se quita su descuento. No cuenta para el límite del año.`,
      { titulo: enCurso ? '¿Terminar la pausa hoy?' : '¿Cancelar la pausa?', si: enCurso ? 'Terminar pausa' : 'Cancelar pausa', no: 'Volver' }))) return;
    await encolar({ tipo: 'TERMINAR_PAUSA', idServ: b.dataset.terminar, idCliente: id, fecha: hoyISO(), motivo: enCurso ? 'Volvió antes' : 'Pausa cancelada' });
    b.disabled = true;
    aviso(navigator.onLine ? 'Enviado.' : 'Guardado: se enviará al volver la señal.');
  }; });
  const bRen = $('#btnRenovar');
  if (bRen && !bRen.disabled) bRen.onclick = async () => {
    const anio = Number(bRen.dataset.anio);
    if (!(await confirmar(`Se generarán las cuotas de ENE a DIC ${anio} para los servicios activos de ${c.NOMBRES}.`,
      { titulo: `¿Renovar contrato ${anio}?`, si: 'Renovar' }))) return;
    await encolar({ tipo: 'RENOVAR_ANIO', idCliente: id, datos: { anio } });
    bRen.disabled = true;
    aviso(navigator.onLine ? 'Renovación enviada.' : 'Guardada: se enviará al volver la señal.');
  };
  $('#listaPagos').addEventListener('click', (e) => {
    const bp = e.target.closest('[data-pdf]'), ba = e.target.closest('[data-anular]');
    if (bp) { prepararPdf(bp.dataset.pdf, $('#zonaPdf')); $('#zonaPdf').scrollIntoView({ behavior: 'smooth' }); }
    if (ba) anularRecibo(ba.dataset.anular);
  });
}

/**
 * Botón "Renovar contrato anual": genera las cuotas del año siguiente.
 * Solo se habilita si el cliente NO tiene deuda vencida (el servidor vuelve a comprobarlo).
 */
function bloqueRenovar(id, r) {
  const activos = serviciosDe(id).filter((s) => s.ESTADO === 'Activo');
  if (!activos.length) return '';
  const anio = Number(hoyISO().slice(0, 4)) + 1;
  const idsServ = new Set(activos.map((s) => s.ID_SERV));
  const yaTiene = D.cargos.some((k) => idsServ.has(k.ID_SERV) && k.CONCEPTO === 'MENSUALIDAD' && String(k.PERIODO).startsWith(anio + '-'));
  const deuda = Number(r.DEUDA_VENCIDA) || 0;
  const motivo = yaTiene ? `El contrato ${anio} ya está renovado.`
    : deuda > 0 ? `Disponible cuando no tenga deuda vencida (debe ${soles(deuda)}).` : `Genera las cuotas de ENE a DIC ${anio}.`;
  return `<h3>Contrato</h3>
      <button class="btn" id="btnRenovar" data-anio="${anio}" ${yaTiene || deuda > 0 ? 'disabled aria-disabled="true"' : ''}>${ic('documento')}Renovar contrato anual ${anio}</button>
      <p class="sub">${esc(motivo)}</p>`;
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
  const fila = (k) => {
    const futuro = String(k.PERIODO).slice(0, 7) > hoyMes;
    const marcado = !futuro;   // por defecto: vencidos y del mes
    return `<label class="cargo ${futuro ? 'futuro' : ''}" ${futuro ? 'data-futuro="1"' : ''}>
      <input type="checkbox" value="${esc(k.ID_CARGO)}" data-saldo="${Number(k.SALDO)}" ${marcado ? 'checked' : ''}>
      <span class="per">${esc(txtPeriodo(k.PERIODO))}</span>
      <span class="det">${esc(k.CONCEPTO === 'MENSUALIDAD' ? k.PLAN : k.CONCEPTO)}${Number(k.PAGADO) > 0 ? ' · pagado ' + soles(k.PAGADO) : ''}</span>
      <span class="chip ${claseEstado(k.ESTADO)}">${esc(k.ESTADO)}</span>
      <b>${soles(k.SALDO)}</b></label>`;
  };
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
      </div>
      <div id="cargos" class="cargos">${todos.map(fila).join('') || '<p class="vacio">No tiene meses pendientes.</p>'}</div>
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
  const cajas = () => [...document.querySelectorAll('#cargos input[type=checkbox]')];
  const visibles = () => cajas().filter((x) => !x.closest('label').hidden);
  const futuros = () => cajas().filter((x) => x.closest('label').dataset.futuro);
  futuros().forEach((x) => { x.closest('label').hidden = true; x.checked = false; });
  const total = () => r2(cajas().filter((x) => x.checked && !x.closest('label').hidden).reduce((s, x) => s + Number(x.dataset.saldo), 0));
  const recalc = (ponerMonto = true) => {
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
  $('#cargos').addEventListener('change', () => recalc());
  $('#monto').addEventListener('input', validarMonto);
  $('#selVenc').onclick = () => { visibles().forEach((x) => { x.checked = !x.closest('label').dataset.futuro; }); recalc(); };
  $('#selTodo').onclick = () => { visibles().forEach((x) => { x.checked = true; }); recalc(); };
  $('#selNada').onclick = () => { cajas().forEach((x) => { x.checked = false; }); recalc(); };
  $('#verFut').onchange = (e) => { futuros().forEach((x) => { x.closest('label').hidden = !e.target.checked; if (!e.target.checked) x.checked = false; }); recalc(); };
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
    const sel = cajas().filter((x) => x.checked && !x.closest('label').hidden);
    const monto = r2($('#monto').value || 0), t = total(), metodo = $('#metodo').value;
    if (!sel.length) return aviso('Marque al menos un mes.', 'error');
    if (!(monto > 0)) return aviso('Ingrese el monto recibido.', 'error');
    if (monto > t + 0.004) return aviso('El monto supera lo seleccionado.', 'error');
    if (metodo !== 'Efectivo' && !$('#operacion').value.trim() &&
        !(await confirmar(`No ingresó N° de operación de ${metodo}.`, { titulo: '¿Registrar de todos modos?', si: 'Registrar' }))) return;
    const cargosSel = D.cargos.filter((k) => sel.some((x) => x.value === k.ID_CARGO))
      .sort((a, b) => String(a.PERIODO).localeCompare(String(b.PERIODO)));
    const reparto = repartir(cargosSel, monto);
    if (!(await confirmar(`${c.NOMBRES}\nMétodo: ${metodo}\n` +
        reparto.map((x) => `· ${txtPeriodo(x.cargo.PERIODO)}: ${soles(x.aplicado)}${x.parcial ? ' (parcial)' : ''}`).join('\n'),
        { titulo: `Registrar ${soles(monto)}${monto < t - 0.004 ? ' (parcial)' : ''}`, si: 'Registrar cobro' }))) return;
    $('#btnCobrar').disabled = true;
    const op = {
      tipo: 'COBRO', idCliente: id, cargos: cargosSel.map((k) => k.ID_CARGO), monto, metodo,
      operacion: $('#operacion').value.trim(), obs: $('#obs').value.trim(), fechaPago: hoyISO(),
      foto: metodo === 'Efectivo' ? '' : fotoData,
      reciboProvisional: await siguienteProvisional(PERFIL.iniciales),
      // copia para mostrar el comprobante aunque no haya señal
      vista: { cliente: c.NOMBRES, doc: c.DNI_RUC, zona: c.ZONA, telefono: c.TELEFONO, usuario: PERFIL.nombre,
        detalle: reparto.map((x) => ({ periodo: txtPeriodo(x.cargo.PERIODO), concepto: x.cargo.CONCEPTO === 'MENSUALIDAD' ? x.cargo.PLAN : x.cargo.CONCEPTO,
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
  const texto = `*${cfg.Negocio || 'D@NDINET'}* — ${oficial ? 'RECIBO DE PAGO' : 'RECIBO PROVISIONAL'} ${nro}\n` +
    `Fecha: ${txtFecha(op.fechaPago)}\nCliente: ${v.cliente}\n` +
    v.detalle.map((d) => `• ${d.periodo} ${d.concepto}: ${soles(d.aplicado)}${d.parcial ? ' (parcial)' : ''}`).join('\n') +
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
        ${v.detalle.map((d) => `<tr><td>${esc(d.periodo)}</td><td>${esc(d.concepto)}${d.parcial ? ' <small>(parcial)</small>' : ''}</td><td>${soles(d.aplicado)}</td></tr>`).join('')}
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
  const periodos = txtPeriodos(p.PERIODOS).split(/\s*[,;]\s*/).filter(Boolean);
  vista().innerHTML = `
    <section class="recibo ${anulado ? 'rechazado' : ''}">
      <div class="cab"><b>${esc(cfg.Negocio || 'D@NDINET')}</b><span>RECIBO DE PAGO</span><strong>N° ${esc(p.N_RECIBO)}</strong></div>
      ${anulado ? '<p class="aviso error">Este recibo está ANULADO.</p>' : ''}
      <dl><dt>Fecha</dt><dd>${esc(txtFecha(p.FECHA))}</dd><dt>Cliente</dt><dd>${esc(p.CLIENTE)}</dd>
        <dt>Código</dt><dd>${esc(p.ID_CLIENTE)}</dd><dt>Atendió</dt><dd>${esc(p.USUARIO)}</dd></dl>
      <table class="periodos"><thead><tr><th>Periodos pagados</th></tr></thead><tbody>
        ${periodos.map((x) => `<tr><td>${esc(x)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</tbody></table>
      <div class="totalr">TOTAL <b>${soles(p.MONTO)}</b></div>
      <p class="sub">${esc(p.METODO)}${p.OPERACION ? ' · Op. ' + esc(p.OPERACION) : ''}${Number(p.SALDO_RESTANTE) > 0 ? ' · Saldo pendiente ' + soles(p.SALDO_RESTANTE) : ''}</p>
      <p class="pie">Recibo interno de control de pagos. No es comprobante SUNAT.</p>
      <div id="zonaPdf"><button class="btn grande azul" id="btnPdf">${ic('documento')}Recibo PDF</button></div>
      ${anulado ? '' : `<button class="btn" id="btnWsp">${ic('chat')}Enviar texto por WhatsApp</button>`}
      <a class="btn" href="#/cliente/${esc(p.ID_CLIENTE)}">Ver cliente</a>
      <a class="btn secundario" href="#/hoy">Volver</a>
    </section>`;
  $('#btnPdf').onclick = () => prepararPdf(p.N_RECIBO, $('#zonaPdf'));
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
  let r = await kvGet('pdf2_' + nro);
  if (!r || r.estado !== estado) {          // no está guardado o cambió (por ejemplo, se anuló)
    if (!navigator.onLine) return aviso('Se necesita señal para generar el PDF la primera vez.', 'error');
    zona.innerHTML = '<p class="aviso">Generando el PDF de ' + esc(nro) + '… (solo la primera vez)</p>';
    try {
      r = await llamar('comprobante', { nro });
      r.estado = estado;
      await kvSet('pdf2_' + nro, r);
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
  zona.innerHTML = `<p class="sub etq-ic">${ic('documento')}${esc(r.nombre)}</p>` +
    (puedeCompartir ? `<button class="btn grande verde" id="btnShare">${ic('compartir')}Compartir PDF (WhatsApp…)</button>` : '') +
    `<a class="btn" href="${url}" download="${esc(r.nombre)}">${ic('descargar')}Descargar PDF</a><a class="btn" href="${url}" target="_blank" rel="noopener">${ic('ver')}Ver PDF</a>`;
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
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
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
      <div id="mapa" class="mapa"></div><p class="sub" id="mapaTxt"></p>
      <div class="botones"><button class="btn" id="mapaYo">${ic('ubicacion')}Mi ubicación</button><button class="btn verde" id="mapaOk">${ic('check')}Usar esta</button></div>
      <button class="btn secundario" id="mapaNo">Cancelar</button>`);
    fondo.querySelector('.modal').classList.add('grande');
    const mapa = L.map('mapa').setView(punto, m0 ? 17 : 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
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
      const nombres = { GUARDAR_CONFIG: 'Datos del negocio', EDITAR_PPPOE: 'Editar PPPoE', CREAR_ORDEN: 'Orden / hoja de ruta', CERRAR_ITEM_ORDEN: 'Marcar en orden', ANULAR_ORDEN: 'Anular orden', PAUSA_VACACIONES: 'Pausa vacacional', TERMINAR_PAUSA: 'Fin de pausa', CAMBIAR_PLAN: 'Cambio de plan', RENOVAR_ANIO: 'Renovar contrato', ALTA_CLIENTE: 'Nuevo cliente', EDITAR_CLIENTE: 'Editar cliente', ANULAR_PAGO: 'Anular recibo', CORTAR: 'Corte',
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

function vCorte(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  vista().innerHTML = `<section class="form"><h2>Corte / suspensión / baja</h2>
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.PLAN)} · PPPoE ${esc(s.PPPOE || '-')}</p>
    <label>Acción<select id="acc"><option value="CORTAR">Corte (libera el PPPoE, conserva la deuda)</option>
      <option value="SUSPENDER">Suspensión (reserva el PPPoE)</option><option value="BAJA">Baja definitiva</option></select></label>
    <label>Motivo<input id="motivo" value="Falta de pago"></label>
    <label class="check"><input type="checkbox" id="cobrarMes" checked> Cobrar el mes del corte</label>
    <button class="btn grande rojo" id="ok">EJECUTAR</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  $('#ok').onclick = async () => {
    const motivo = $('#motivo').value.trim();
    if (motivo.length < 3) return aviso('Indique el motivo.', 'error');
    const accion = $('#acc').value;
    if (!(await confirmar(s.CLIENTE, { titulo: `¿${$('#acc').selectedOptions[0].text.split(' (')[0]}?`, si: 'Ejecutar', peligro: true }))) return;
    await encolar({ tipo: accion, idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, motivo, fecha: hoyISO(), cobrarMesCorte: $('#cobrarMes').checked });
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
  vista().innerHTML = `<section class="form"><h2>Reactivar servicio</h2>
    <p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.ESTADO)} · PPPoE anterior ${esc(s.PPPOE_ANT || '-')}</p>
    ${Number(r.DEUDA_VENCIDA) > 0 ? `<p class="aviso error">Aún debe ${soles(r.DEUDA_VENCIDA)}. <a href="#/cobrar/${esc(s.ID_CLIENTE)}">Cobrar primero</a></p>` : ''}
    <label>PPPoE<select id="ppp"><option value="">(sin PPPoE)</option>${propio.concat(disp).map((p) =>
      `<option ${p === (s.PPPOE || s.PPPOE_ANT) ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label>Tarifa mensual (S/)<input id="tarifa" type="number" step="0.10" value="${Number(s.TARIFA) || ''}"></label>
    <label>Motivo<input id="motivo" value="Reactivación por pago"></label>
    <button class="btn grande verde" id="ok">REACTIVAR</button>
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  $('#ok').onclick = async () => {
    if (!(await confirmar(`${s.ID_SERV} de ${s.CLIENTE}`, { titulo: '¿Reactivar servicio?', si: 'Reactivar' }))) return;
    await encolar({ tipo: 'REACTIVAR', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, codigoPPPoE: $('#ppp').value,
      tarifa: $('#tarifa').value, motivo: $('#motivo').value.trim() || 'Reactivación', fecha: hoyISO() });
    aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

// ---- MÁS -------------------------------------------------------------------------------
function vMas() {
  const fila = (href, icono, etq, sub) => `<li><a href="${href}">${ic(icono)}<span class="etq">${etq}<small>${sub}</small></span>${ic('flecha', 'fin')}</a></li>`;
  vista().innerHTML = `<h2>Más opciones</h2>
    <a class="btn grande verde" href="#/nuevo">${ic('nuevoCliente')}Nuevo cliente</a>
    <h3>Gestión</h3>
    <ul class="menu">
      ${fila('#/dashboard', 'grafico', 'Dashboard', 'Recaudación, morosidad y ranking')}
      ${fila('#/cortar', 'cortar', 'A cortar', 'Clientes con 30 días o más de atraso')}
      ${fila('#/ordenes', 'documento', 'Órdenes y hojas de ruta', 'Imprimir, completar y revisar por fechas')}
      ${fila('#/movimientos', 'reloj', 'Reporte de movimientos', 'Cortes, pausas, cambios de plan… por mes')}
      ${fila('#/pppoe', 'router', 'PPPoE', 'Códigos disponibles, asignados y bloqueados')}
      ${fila('#/hoy', 'recibo', 'Mis cobros de hoy', 'Total del día por método')}
    </ul>
    <h3>Ajustes</h3>
    <ul class="menu">
      ${fila('#/negocio', 'editar', 'Datos del negocio y mensajes', 'RUC, dirección, cuentas y mensajes de WhatsApp')}
      ${fila('#/config', 'ajustes', 'Planes y listas', 'Tarifas, zonas, modos y métodos')}
      ${fila('#/cuenta', 'usuario', 'Mi cuenta', 'Sincronizar y cerrar sesión')}
    </ul>`;
}

// ---- NUEVO / EDITAR CLIENTE --------------------------------------------------------
const lst = (tipo) => D.listas.filter((x) => x.TIPO === tipo && x.ACTIVO !== 'No').sort((a, b) => Number(a.ORDEN) - Number(b.ORDEN)).map((x) => x.VALOR);
const docOk = (v) => /^\d{8}$/.test(v) || /^(10|15|17|20)\d{9}$/.test(v);
const telOk = (v) => /^9\d{8}$/.test(v);

function vFormCliente(id) {
  const editar = RUTA === 'editar';
  const c = editar ? D.porId[id] : {};
  if (editar && !c) { vista().innerHTML = '<p class="error">Cliente no encontrado.</p>'; return; }
  const pv = editar ? (D.privados[id] || {}) : {};
  const campo = (k, etq, extra = '') => `<label>${etq}<input id="f_${k}" value="${esc(c[k] !== undefined ? c[k] : (pv[k] || ''))}" ${extra}></label>`;
  const planes = D.planes.filter((p) => p.ACTIVO !== 'No');
  vista().innerHTML = `<section class="form"><h2>${editar ? 'Editar cliente' : 'Nuevo cliente'}</h2>
    ${editar ? `<p class="sub">${esc(id)}</p>` : '<p class="sub">Los campos con * son obligatorios. El ID se asigna al sincronizar.</p>'}
    <label>DNI (8) o RUC (11) *<div class="fila"><input id="f_DNI_RUC" value="${esc(c.DNI_RUC || '')}" inputmode="numeric" maxlength="11"><button type="button" class="mini" id="btnDni">${ic('buscar')}Consultar</button></div></label>
    ${campo('NOMBRES', 'Nombres y apellidos / razón social *', 'autocapitalize="characters"')}
    ${campo('TELEFONO', 'Celular *', 'inputmode="numeric" maxlength="9"')}
    ${campo('TELEFONO2', 'Celular 2', 'inputmode="numeric" maxlength="9"')}
    ${campo('DIRECCION', 'Dirección *')}
    ${campo('REFERENCIA', 'Referencia')}
    <label>Zona *<select id="f_ZONA"><option value="">— elegir —</option>${lst('ZONA').map((z) => `<option ${z === c.ZONA ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
    <label>Coordenadas<div class="fila"><input id="f_COORDENADAS" value="${esc(c.COORDENADAS || '')}" placeholder="-11.44, -74.43"><button type="button" class="mini" id="gps">${ic('ubicacion')}Aquí</button><button type="button" class="mini" id="btnMapa">${ic('mapa')}Mapa</button></div></label>
    ${campo('DIA_VENC', 'Día de vencimiento (1–28)', `inputmode="numeric" placeholder="${esc(D.config.DiaVenc || 4)}"`)}
    ${campo('OBSERVACIONES', 'Observaciones')}
    <h3>WiFi y router</h3>
    ${campo('USUARIO_WIFI', 'Usuario / red WiFi')}${campo('CLAVE_WIFI', 'Clave WiFi')}
    ${campo('USUARIO_ROUTER', 'Usuario router')}${campo('CLAVE_ROUTER', 'Clave router')}
    ${editar ? '' : `<h3>Servicio</h3>
      <label>Plan *<select id="s_plan"><option value="">— elegir —</option>${planes.map((p) => `<option data-t="${Number(p.TARIFA)}">${esc(p.PLAN)}</option>`).join('')}</select></label>
      <label>Tarifa mensual (S/)<input id="s_tarifa" type="number" step="0.10" inputmode="decimal"></label>
      <label>Modo / equipo<select id="s_modo"><option value=""></option>${lst('MODO').map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label>PPPoE<select id="s_pppoe"><option value="">(sin PPPoE)</option>${pppoeDisponibles().map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label>Fecha de inicio<input id="s_inicio" type="date" value="${hoyISO()}"></label>
      <label>Instalación (S/)<input id="s_inst" type="number" step="0.10" inputmode="decimal" value="0"></label>
      <p class="sub">El primer mes se prorratea según el día de instalación; las cuotas se generan hasta diciembre.</p>`}
    <button class="btn grande verde" id="ok">${editar ? 'GUARDAR CAMBIOS' : 'REGISTRAR CLIENTE'}</button>
    <a class="btn secundario" href="${editar ? '#/cliente/' + esc(id) : '#/mas'}">Cancelar</a></section>`;
  if (!editar) $('#s_plan').onchange = (e) => { const o = e.target.selectedOptions[0]; $('#s_tarifa').value = o && o.dataset.t ? o.dataset.t : ''; };
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
  $('#ok').onclick = async () => {
    const v = (k) => $('#f_' + k).value.trim();
    const d = {};
    ['DNI_RUC', 'NOMBRES', 'TELEFONO', 'TELEFONO2', 'DIRECCION', 'REFERENCIA', 'ZONA', 'COORDENADAS', 'DIA_VENC', 'OBSERVACIONES',
      'USUARIO_WIFI', 'CLAVE_WIFI', 'USUARIO_ROUTER', 'CLAVE_ROUTER'].forEach((k) => { d[k] = v(k); });
    // validaciones (el servidor las vuelve a hacer)
    if (!docOk(d.DNI_RUC)) return aviso('DNI de 8 dígitos o RUC de 11 (empieza con 10, 15, 17 o 20).', 'error');
    if (!d.NOMBRES) return aviso('Escriba el nombre.', 'error');
    if (!telOk(d.TELEFONO)) return aviso('Celular: 9 dígitos que empiezan con 9.', 'error');
    if (d.TELEFONO2 && !telOk(d.TELEFONO2)) return aviso('Celular 2 inválido (o déjelo vacío).', 'error');
    if (!d.DIRECCION) return aviso('Escriba la dirección.', 'error');
    if (!d.ZONA) return aviso('Elija la zona.', 'error');
    if (d.DIA_VENC && !(Number(d.DIA_VENC) >= 1 && Number(d.DIA_VENC) <= 28)) return aviso('Día de vencimiento entre 1 y 28.', 'error');
    const repetido = D.clientes.find((x) => x.DNI_RUC === d.DNI_RUC && x.ID_CLIENTE !== id);
    if (repetido) return aviso(`El DNI/RUC ya es de ${repetido.ID_CLIENTE} ${repetido.NOMBRES}.`, 'error');
    if (editar) {
      await encolar({ tipo: 'EDITAR_CLIENTE', idCliente: id, datos: d });
      aviso(navigator.onLine ? 'Cambios enviados.' : 'Cambios guardados: se enviarán al volver la señal.');
      location.hash = '#/cliente/' + id;
      return;
    }
    const plan = $('#s_plan').value, tarifa = Number($('#s_tarifa').value || 0);
    if (!plan) return aviso('Elija el plan del servicio.', 'error');
    if (!(tarifa > 0)) return aviso('La tarifa debe ser mayor a 0.', 'error');
    if (!(await confirmar(`${d.NOMBRES}\n${plan} · ${soles(tarifa)}/mes`, { titulo: '¿Registrar cliente?', si: 'Registrar' }))) return;
    d.FECHA_ALTA = $('#s_inicio').value || hoyISO();
    await encolar({ tipo: 'ALTA_CLIENTE', datos: { cliente: d, servicio: { plan, tarifa, modo: $('#s_modo').value,
      pppoe: $('#s_pppoe').value, fechaInicio: d.FECHA_ALTA, montoInstalacion: Number($('#s_inst').value || 0) } } });
    aviso(navigator.onLine ? 'Cliente enviado. Aparecerá en la búsqueda en unos segundos.' : 'Guardado sin señal: se registrará al volver la conexión.');
    location.hash = '#/cola';
  };
}

// ---- PPPoE ---------------------------------------------------------------------------
function vPPPoE() {
  let filtro = 'Todos';
  // historial agrupado por código, una sola vez (búsqueda instantánea y sin consultar al servidor)
  const hist = {};
  D.histPPPoE.forEach((h) => { (hist[h.CODIGO] = hist[h.CODIGO] || []).push(h); });
  Object.values(hist).forEach((l) => l.sort((x, y) => String(y.F_DESDE).localeCompare(String(x.F_DESDE))));
  const cuenta = (e) => D.pppoe.filter((p) => p.ESTADO === e).length;
  vista().innerHTML = `<h2>PPPoE</h2>
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
      <div class="der"><span class="chip ${p.ESTADO === 'Disponible' ? 'e-activo' : p.ESTADO === 'Asignado' ? 'e-pend' : 'e-moroso'}">${esc(p.ESTADO)}</span>
      <button class="mini" data-editar="${esc(p.CODIGO)}">Editar</button>
      ${p.ESTADO === 'Asignado' ? `<button class="mini" data-acc="LIBERAR_PPPOE" data-c="${esc(p.CODIGO)}">Liberar</button>` : ''}
      ${p.ESTADO === 'Disponible' ? `<button class="mini" data-acc="BLOQUEAR_PPPOE" data-c="${esc(p.CODIGO)}">Bloquear</button>` : ''}
      ${p.ESTADO === 'Bloqueado' ? `<button class="mini" data-acc="DESBLOQUEAR_PPPOE" data-c="${esc(p.CODIGO)}">Desbloquear</button>` : ''}</div></div></li>`;
  };
  const MAX = 50;
  const pintar = () => {
    $('#ppFiltros').innerHTML = ['Todos', 'Disponible', 'Asignado', 'Bloqueado'].map((e) =>
      `<button class="mini ${e === filtro ? 'sel' : ''}" data-f="${e}">${e}${e === 'Todos' ? '' : ' (' + cuenta(e) + ')'}</button>`).join('');
    const q = $('#ppq').value.trim().toLowerCase();
    const coincide = (p) => !q || String(p.CODIGO).toLowerCase().includes(q) || String(p.CLIENTE || '').toLowerCase().includes(q) ||
      String(p.ID_CLIENTE || '').toLowerCase().includes(q) || String(p.TITULAR || '').toLowerCase().includes(q) ||
      (hist[p.CODIGO] || []).some((h) => String(h.CLIENTE || '').toLowerCase().includes(q));
    const lista = D.pppoe.filter((p) => (filtro === 'Todos' || p.ESTADO === filtro) && coincide(p))
      .sort((x, y) => (q && String(y.CODIGO).toLowerCase() === q) - (q && String(x.CODIGO).toLowerCase() === q));   // el código exacto primero
    $('#ppTotal').textContent = lista.length > MAX ? `${lista.length} códigos · mostrando ${MAX}. Escriba más para afinar.` : `${lista.length} código(s)`;
    $('#ppLista').innerHTML = lista.slice(0, MAX).map(fila).join('') || '<li class="vacio">Sin códigos</li>';
    $('#ppFiltros').querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; pintar(); }; });
    $('#ppLista').querySelectorAll('[data-editar]').forEach((b) => { b.onclick = async () => {
      const p = D.pppoe.find((x) => String(x.CODIGO) === b.dataset.editar) || {};
      const t = await pedirTexto('Titular de la cuenta (a nombre de quién está):', { titulo: `Editar PPPoE ${b.dataset.editar}`, valor: p.TITULAR || '', si: 'Guardar' });
      if (t === null) return;
      if (t.trim().length < 3) return aviso('Escriba el titular.', 'error');
      await encolar({ tipo: 'EDITAR_PPPOE', codigoPPPoE: b.dataset.editar, datos: { titular: t.trim() } });
      p.TITULAR = t.trim().toUpperCase();
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
      b.disabled = true;
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
  };
  pintar();
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
const OT_TITULO = { CAMBIO_PLAN: 'ORDEN DE TRABAJO', RUTA_CORTE: 'HOJA DE RUTA DE CORTES' };
const OT_NOMBRE = { CAMBIO_PLAN: 'Orden de trabajo · cambio de plan', RUTA_CORTE: 'Hoja de ruta de cortes' };
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

// ---- REGISTRO: filtros por fechas; las pendientes siempre visibles --------------------------
async function vOrdenes() {
  const hoy = hoyISO(), f = Object.assign({ desde: hoy.slice(0, 8) + '01', hasta: hoy, tipo: '', estado: '' }, (await kvGet('filtrosOrdenes')) || {});
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  vista().innerHTML = `<h2>Órdenes y hojas de ruta</h2>
    <p class="sub">Las pendientes aparecen siempre, hasta que se completen o se anulen.</p>
    <div class="filtros">
      <label>Desde<input id="oDesde" type="date" value="${esc(f.desde)}"></label>
      <label>Hasta<input id="oHasta" type="date" value="${esc(f.hasta)}"></label>
      <label>Tipo<select id="oTipo">${opt('', 'Todos', f.tipo)}${opt('CAMBIO_PLAN', 'Órdenes de trabajo', f.tipo)}${opt('RUTA_CORTE', 'Hojas de ruta', f.tipo)}</select></label>
      <label>Estado<select id="oEstado">${opt('', 'Todos', f.estado)}${opt('Pendiente', 'Pendientes', f.estado)}${opt('Completada', 'Completadas', f.estado)}${opt('Anulada', 'Anuladas', f.estado)}</select></label>
    </div>
    <div id="oLista"></div>`;
  const fila = (o) => {
    const hechos = o.items.filter((x) => x.estado !== 'Pendiente').length;
    return `<li><a href="#/orden/${encodeURIComponent(o.ref)}"><div><b>${esc(o.id)}</b> · ${esc(OT_NOMBRE[o.tipo] || o.tipo)}
      <small>${esc(txtFecha(o.fecha))} ${esc(String(o.fecha).slice(11, 16))} · ${esc(o.detalle)}</small>
      <small>${hechos} de ${o.items.length} resuelto(s)${o.local ? ' · sin enviar' : ''}</small></div>
      <div class="der"><span class="chip ${chipOt(o.estado)}">${esc(o.estado)}</span></div></a></li>`;
  };
  const pintar = async () => {
    Object.assign(f, { desde: $('#oDesde').value, hasta: $('#oHasta').value, tipo: $('#oTipo').value, estado: $('#oEstado').value });
    await kvSet('filtrosOrdenes', f);
    const todas = (await ordenesLocales()).filter((o) => !f.tipo || o.tipo === f.tipo);
    const pend = todas.filter((o) => o.estado === 'Pendiente');
    const dia = (o) => String(o.fecha).slice(0, 10);
    const periodo = todas.filter((o) => o.estado !== 'Pendiente' && (!f.estado || o.estado === f.estado) && (!f.desde || dia(o) >= f.desde) && (!f.hasta || dia(o) <= f.hasta));
    $('#oLista').innerHTML = (!f.estado || f.estado === 'Pendiente' ? `<h3>Pendientes (${pend.length})</h3>
      <ul class="lista">${pend.map(fila).join('') || '<li class="vacio">No hay órdenes pendientes.</li>'}</ul>` : '') +
      (f.estado !== 'Pendiente' ? `<h3>Cerradas del ${esc(txtFecha(f.desde))} al ${esc(txtFecha(f.hasta))} (${periodo.length})</h3>
      <ul class="lista">${periodo.map(fila).join('') || '<li class="vacio">Nada en esas fechas.</li>'}</ul>` : '');
  };
  ['#oDesde', '#oHasta', '#oTipo', '#oEstado'].forEach((x) => { $(x).onchange = pintar; });
  pintar();
}

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
  if (o.tipo === 'CAMBIO_PLAN') {
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
  o.items.forEach((it, i) => {
    const sn = it.snap || {};
    l.push(`\n${o.tipo === 'RUTA_CORTE' ? (i + 1) + '. ' : ''}*${sn.n}* (${it.idCliente})`, `Dirección: ${sn.dir || '—'}${sn.ref ? ' (Ref.: ' + sn.ref + ')' : ''}`,
      `Zona: ${sn.zona || '—'} · Plan: ${sn.plan || '—'} · PPPoE: ${sn.pppoe || '—'}`, `Tel.: ${[sn.tel, sn.tel2].filter(Boolean).join(' / ') || '—'}`);
    if (sn.gps) l.push(`Mapa: ${enlaceMapa(sn.gps)}`);
    if (o.tipo === 'RUTA_CORTE') l.push(`Deuda: ${soles(sn.deuda)} (${txtMora(sn.dias)})`);
  });
  if (o.tipo === 'CAMBIO_PLAN') l.push(`\nCambio: ${o.datos.planAnt || ''} → *${o.datos.plan || ''}* (${soles(o.datos.tarifa)})`);
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
  a.href = url; a.download = `${o.tipo === 'RUTA_CORTE' ? 'HojaRuta' : 'OrdenTrabajo'}_${o.id}_${String(o.fecha).slice(0, 10)}.html`;
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
      ${o.estado === 'Pendiente' ? `<button class="mini rojo" id="dAnular">${ic('anular')}Anular</button>` : ''}
    </div>
    ${o.local ? '<p class="aviso no-imprimir">Orden sin enviar: el N° definitivo llegará al sincronizar. Ya puede imprimirla y trabajar con ella.</p>' : ''}
    ${o.sinEnviar ? '<p class="aviso no-imprimir">Hay marcas sin enviar en esta orden.</p>' : ''}
    ${htmlDocumento(o)}
    ${o.tipo === 'CAMBIO_PLAN' && o.items[0] && o.items[0].estado === 'Pendiente' && o.estado === 'Pendiente' ? `<section class="no-imprimir form cierre-ot">
      <h3>Completar instalación</h3>
      <label>Fecha de instalación<input id="dFecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label>
      <button class="btn grande verde" id="dCompletar">${ic('check')}Marcar como completada</button>
      <button class="btn" id="dNoEjec">No se pudo instalar</button></section>` : ''}`;
  // acciones por cliente en la hoja de ruta (no se imprimen)
  vista().querySelectorAll('.acc-item').forEach((div) => {
    const it = o.items.find((x) => x.idServ === div.dataset.serv), r = D.resumen[it.idCliente] || {};
    if (it.estado !== 'Pendiente' || o.estado !== 'Pendiente') { div.remove(); return; }
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
      if (!(await confirmar(`${it.snap.n}\n${o.datos.planAnt || ''} → ${o.datos.plan} (${soles(o.datos.tarifa)})\nInstalado el ${txtFecha(fe)}: se aplica el cambio con prorrateo.`,
        { titulo: '¿Instalación completada?', si: 'Completar' }))) return;
      await encolar({ tipo: 'CERRAR_ITEM_ORDEN', idServ: it.idServ, idCliente: it.idCliente, fecha: fe, motivo: '', datos: { ref: refEnvio, resultado: 'EJECUTADO' } });
      aviso(navigator.onLine ? 'Enviado: el plan se actualizará en segundos.' : 'Guardado: se enviará al volver la señal.');
      vOrden(ref);
    };
    $('#dNoEjec').onclick = async () => {
      const m = await pedirTexto('¿Por qué no se pudo instalar?', { titulo: it.snap.n, si: 'Guardar' });
      if (m === null) return;
      if (m.trim().length < 3) return aviso('Escriba el motivo.', 'error');
      await encolar({ tipo: 'CERRAR_ITEM_ORDEN', idServ: it.idServ, idCliente: it.idCliente, fecha: hoyISO(), motivo: m.trim(), datos: { ref: refEnvio, resultado: 'NO_EJECUTADO' } });
      aviso('Guardado. La orden queda cerrada sin cambiar el plan.');
      vOrden(ref);
    };
  }
}

// ---- REPORTE DE MOVIMIENTOS (mes y año, tipo, zona) -------------------------------------------
async function vMovimientos() {
  const hoy = hoyISO(), f = Object.assign({ anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)), tipo: '', zona: '' }, (await kvGet('filtrosMov')) || {});
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`;
  const tipos = ['Corte', 'Suspensión', 'Pausa vacacional', 'Cambio de plan', 'Reactivación', 'Baja', 'Alta', 'Renovación', 'Orden de trabajo', 'Hoja de ruta', 'Otro'];
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
const CAMPOS_COBRO = [['Yape', 'N° Yape / Plin', 'numeric'], ['TitularCobro', 'Titular de las cuentas', 'text'], ['BCP', 'Cuenta BCP', 'numeric'], ['BN', 'Cuenta Banco de la Nación', 'numeric']];
const MENSAJES = [
  ['MsgCobranza', 'Recordatorio de pago (WhatsApp)'], ['MsgCorte', 'Aviso de corte (WhatsApp)'], ['MensajeRecibo', 'Mensaje al pie del recibo'],
];
const VARIABLES = [['{NOMBRE}', 'nombre'], ['{DEUDA}', 'deuda'], ['{MESES}', 'meses'], ['{PERIODOS}', 'meses que debe'], ['{DIA}', 'día de pago'],
  ['{YAPE}', 'Yape'], ['{TITULAR}', 'titular'], ['{BCP}', 'BCP'], ['{BN}', 'B. Nación'], ['{NEGOCIO}', 'negocio']];

function vNegocio() {
  const cfg = D.config, txt = (k) => String(cfg[k] || '').replace(/\\n/g, '\n');
  const campo = ([k, etq, tipo]) => `<label>${esc(etq)}<input data-k="${k}" value="${esc(txt(k))}" ${tipo === 'numeric' ? 'inputmode="numeric"' : tipo === 'email' ? 'type="email"' : ''} autocomplete="off"></label>`;
  // cliente de ejemplo para la vista previa: el primero con deuda
  const ej = Object.values(D.resumen).find((r) => Number(r.DEUDA_VENCIDA) > 0) || Object.values(D.resumen)[0] || {};
  vista().innerHTML = `<section class="form"><h2>Datos del negocio y mensajes</h2>
    <p class="sub">Salen en los recibos, órdenes, hojas de ruta y mensajes de WhatsApp. Los cambios se aplican al sincronizar.</p>
    <h3>Negocio</h3>${CAMPOS_NEGOCIO.map(campo).join('')}
    <h3>Cuentas para recibir pagos</h3>${CAMPOS_COBRO.map(campo).join('')}
    <h3>Mensajes</h3>
    <p class="sub">Toque una variable para insertarla donde está el cursor. Se reemplaza por el dato de cada cliente.</p>
    ${MENSAJES.map(([k, etq]) => `<label>${esc(etq)}<textarea data-k="${k}" rows="${k === 'MensajeRecibo' ? 2 : 7}">${esc(txt(k))}</textarea></label>
      ${k !== 'MensajeRecibo' ? `<div class="chips vars">${VARIABLES.map(([v, d]) => `<button type="button" class="mini" data-var="${v}" data-para="${k}" title="${esc(d)}">${v}</button>`).join('')}</div>
      <details class="previa"><summary>Vista previa con ${esc(ej.NOMBRES || 'un cliente')}</summary><pre data-previa="${k}"></pre></details>` : ''}`).join('')}
    <button class="btn grande verde" id="ok">${ic('check')}Guardar cambios</button>
    <a class="btn secundario" href="#/mas">Cancelar</a></section>`;
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
    CAMPOS_NEGOCIO.concat(CAMPOS_COBRO).concat(MENSAJES).forEach(([k]) => { const v = valor(k).trim(); if (v !== txt(k).trim()) valores[k] = v; });
    if (!Object.keys(valores).length) return aviso('No hay cambios.');
    // mismas validaciones que el servidor
    if ('RUC' in valores && valores.RUC && !/^(10|15|17|20)\d{9}$/.test(valores.RUC)) return aviso('RUC: 11 dígitos que empiecen con 10, 15, 17 o 20.', 'error');
    for (const k of ['Telefono', 'Yape']) if (k in valores && valores[k] && !/^9\d{8}$/.test(valores[k])) return aviso('Celular: 9 dígitos que empiecen con 9.', 'error');
    if ('Email' in valores && valores.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valores.Email)) return aviso('Correo inválido.', 'error');
    if (!(await confirmar(Object.keys(valores).join(', '), { titulo: '¿Guardar estos cambios?', si: 'Guardar' }))) return;
    await encolar({ tipo: 'GUARDAR_CONFIG', datos: { valores } });
    Object.assign(D.config, valores);
    aviso(navigator.onLine ? 'Guardado. Los recibos nuevos ya salen con estos datos.' : 'Guardado: se enviará al volver la señal.');
    location.hash = '#/mas';
  };
}

function vAsignarPPPoE(idServ) {
  const s = servicioPorId(idServ);
  if (!s) { vista().innerHTML = '<p class="error">Servicio no encontrado.</p>'; return; }
  const disp = pppoeDisponibles();
  vista().innerHTML = `<section class="form"><h2>Asignar PPPoE</h2><p class="sub">${esc(s.CLIENTE)} · ${esc(s.ID_SERV)} · ${esc(s.PLAN)}</p>
    ${disp.length ? `<label>Código disponible<select id="ppp">${disp.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
    <button class="btn grande verde" id="ok">ASIGNAR</button>` : '<p class="aviso">No hay códigos disponibles. Agregue uno en PPPoE.</p>'}
    <a class="btn secundario" href="#/cliente/${esc(s.ID_CLIENTE)}">Cancelar</a></section>`;
  if (disp.length) $('#ok').onclick = async () => {
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
    <span class="val">${formato(x[campo])}</span></div>`).join('')}</div>`;
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
      ${d.porMes.filter((x) => x.esperado || x.recaudado).map((x) => `<tr><td>${x.mes}</td><td>${soles(x.recaudado)}</td><td>${soles(x.esperado)}</td><td>${pct(x.pctCobrado)}</td></tr>`).join('')}
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
