// APP D@NDINET — pantallas y navegación (#/ruta)
import { CONFIG } from './config.js';
import { kvGet, kvSet, colaTodos, borrarTodo } from './db.js';
import { iniciarGoogle, dibujarBoton, leerToken, cerrarSesionGoogle, googleDisponible } from './auth.js';
import { llamar } from './api.js';
import { encolar, sincronizarTodo, iniciarAutoSync, alCambiar, pendientesDeEnvio, siguienteProvisional } from './sync.js';
import {
  D, cargarDatosLocales, esc, soles, r2, txtPeriodo, txtFecha, hoyISO, metodosPago, buscarClientes, serviciosDe,
  cargosDe, repartir, pppoeDisponibles, plantilla, enlaceWhatsApp, claseEstado, txtMora,
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
  if (!/^#\/(cobrar|corte|reactivar|nuevo|editar|asignar|pppoe|config)/.test(h) && !$('#modal')) enrutar();   // no interrumpir un formulario
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
    hoy: vHoy, cortar: vACortar, corte: vCorte, reactivar: vReactivar, cuenta: vCuenta, pago: vPago,
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
          <div><b>${esc(s.PLAN)}</b><small>${esc(s.ID_SERV)} · ${esc(s.MODO)} · ${soles(s.TARIFA)}/mes · PPPoE ${esc(s.PPPOE || '-')}</small></div>
          <div class="der"><span class="chip ${claseEstado(s.ESTADO)}">${esc(s.ESTADO)}</span>
          ${s.ESTADO === 'Activo' ? `<a class="mini rojo" href="#/corte/${esc(s.ID_SERV)}">Cortar</a>` : ''}
          ${s.ESTADO === 'Activo' && !s.PPPOE ? `<a class="mini" href="#/asignar/${esc(s.ID_SERV)}">Asignar PPPoE</a>` : ''}
          ${s.ESTADO === 'Cortado' || s.ESTADO === 'Suspendido' ? `<a class="mini verde" href="#/reactivar/${esc(s.ID_SERV)}">Reactivar</a>` : ''}</div>
        </div>`).join('') || '<p class="vacio">Sin servicios</p>'}
      <h3>Últimos pagos</h3>
      <ul class="lista compacta" id="listaPagos">${pagos.map((p) => `<li><div><b>${esc(p.N_RECIBO)}</b><small>${esc(txtFecha(p.FECHA))} · ${esc(p.METODO)} · ${esc(p.PERIODOS)}</small></div>
        <div class="der">${soles(p.MONTO)}${p.ESTADO === 'Anulado' ? '<small class="error">ANULADO</small>' : ''}
          <span class="acciones-pago"><button class="mini" data-pdf="${esc(p.N_RECIBO)}">${ic('documento')}PDF</button>${p.ESTADO !== 'Anulado' ? `<button class="mini rojo" data-anular="${esc(p.N_RECIBO)}">Anular</button>` : ''}</span></div></li>`).join('') || '<li class="vacio">Sin pagos recientes</li>'}</ul>
      <div id="zonaPdf"></div>
    </section>`;
  $('#btnRecordatorio').onclick = () => enviarWhatsApp(id, plantilla('MsgCobranza', id));
  $('#listaPagos').addEventListener('click', (e) => {
    const bp = e.target.closest('[data-pdf]'), ba = e.target.closest('[data-anular]');
    if (bp) { prepararPdf(bp.dataset.pdf, $('#zonaPdf')); $('#zonaPdf').scrollIntoView({ behavior: 'smooth' }); }
    if (ba) anularRecibo(ba.dataset.anular);
  });
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

// ---- RECIBO DE UN PAGO DEL SERVIDOR (registrado en otro equipo o antes de borrar datos) ---
// Usa los pagos que ya llegan en la sincronización: no descarga nada extra ni ocupa más espacio.
function vPago(nro) {
  const p = D.pagos.find((x) => x.N_RECIBO === nro);
  if (!p) { vista().innerHTML = '<p class="error">Recibo no encontrado en los datos del celular (solo se guardan los últimos 13 meses).</p>'; return; }
  const cfg = D.config, anulado = p.ESTADO === 'Anulado';
  const periodos = String(p.PERIODOS || '').split(/\s*[,;]\s*/).filter(Boolean);
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
      const nombres = { ALTA_CLIENTE: 'Nuevo cliente', EDITAR_CLIENTE: 'Editar cliente', ANULAR_PAGO: 'Anular recibo', CORTAR: 'Corte',
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
    <ul class="lista" id="cLista"></ul>`;
  const pintar = async () => {
    f.zona = $('#fZona').value; f.meses = Number($('#fMeses').value); f.orden = $('#fOrden').value;
    await kvSet('filtrosCortar', f);
    const [campo, dir] = f.orden.split('-');
    const valor = (r) => Number(campo === 'deuda' ? r.DEUDA_VENCIDA : r.DIAS_ATRASO) || 0;
    const lista = todos.filter((r) => (!f.zona || r.ZONA === f.zona) && (Number(r.MESES_ADEUDA) || 0) >= f.meses)
      .sort((x, y) => (dir === 'asc' ? 1 : -1) * (valor(x) - valor(y)));
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
      ${fila('#/pppoe', 'router', 'PPPoE', 'Códigos disponibles, asignados y bloqueados')}
      ${fila('#/hoy', 'recibo', 'Mis cobros de hoy', 'Total del día por método')}
    </ul>
    <h3>Ajustes</h3>
    <ul class="menu">
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
  const pintar = () => {
    const cuenta = (e) => D.pppoe.filter((p) => p.ESTADO === e).length;
    const lista = D.pppoe.filter((p) => filtro === 'Todos' || p.ESTADO === filtro);
    vista().innerHTML = `<h2>PPPoE</h2>
      <div class="acciones-sel">${['Todos', 'Disponible', 'Asignado', 'Bloqueado'].map((e) =>
        `<button class="mini ${e === filtro ? 'sel' : ''}" data-f="${e}">${e}${e === 'Todos' ? '' : ' (' + cuenta(e) + ')'}</button>`).join('')}</div>
      <button class="btn" id="agregar">${ic('agregar')}Agregar código</button>
      <ul class="lista">${lista.map((p) => `<li><div class="pp"><div><b>${esc(p.CODIGO)}</b><small>Titular: ${esc(p.TITULAR || '-')}</small>
        ${p.CLIENTE ? `<small>Cliente: <a href="#/cliente/${esc(p.ID_CLIENTE)}">${esc(p.CLIENTE)}</a></small>` : ''}</div>
        <div class="der"><span class="chip ${p.ESTADO === 'Disponible' ? 'e-activo' : p.ESTADO === 'Asignado' ? 'e-pend' : 'e-moroso'}">${esc(p.ESTADO)}</span>
        ${p.ESTADO === 'Asignado' ? `<button class="mini" data-acc="LIBERAR_PPPOE" data-c="${esc(p.CODIGO)}">Liberar</button>` : ''}
        ${p.ESTADO === 'Disponible' ? `<button class="mini" data-acc="BLOQUEAR_PPPOE" data-c="${esc(p.CODIGO)}">Bloquear</button>` : ''}
        ${p.ESTADO === 'Bloqueado' ? `<button class="mini" data-acc="DESBLOQUEAR_PPPOE" data-c="${esc(p.CODIGO)}">Desbloquear</button>` : ''}</div></div></li>`).join('') || '<li class="vacio">Sin códigos</li>'}</ul>`;
    vista().querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtro = b.dataset.f; pintar(); }; });
    vista().querySelectorAll('[data-acc]').forEach((b) => { b.onclick = async () => {
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
    $('#agregar').onclick = async () => {
      const cod = ((await pedirTexto('Código PPPoE nuevo:', { titulo: 'Agregar código', si: 'Siguiente' })) || '').trim();
      if (!cod) return;
      if (D.pppoe.some((p) => String(p.CODIGO) === cod)) return aviso('Ese código ya existe.', 'error');
      const titular = await pedirTexto('Titular de la cuenta (a nombre de quién está):', { titulo: `Código ${cod}`, si: 'Agregar' });
      if (titular === null) return;
      await encolar({ tipo: 'AGREGAR_PPPOE', codigoPPPoE: cod, datos: { titular: titular.trim() } });
      aviso(navigator.onLine ? 'Código enviado.' : 'Guardado: se enviará al volver la señal.');
    };
  };
  pintar();
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
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', oscuro ? '#0f1730' : '#1c1e54'); });
}

window.addEventListener('DOMContentLoaded', arrancar);
