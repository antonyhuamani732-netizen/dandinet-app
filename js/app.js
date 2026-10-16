// APP D@NDINET — pantallas y navegación (#/ruta)
import { CONFIG } from './config.js';
import { kvGet, kvSet, colaTodos, borrarTodo } from './db.js';
import { iniciarGoogle, dibujarBoton, leerToken, cerrarSesionGoogle, googleDisponible } from './auth.js';
import { llamar } from './api.js';
import { encolar, sincronizarTodo, iniciarAutoSync, alCambiar, pendientesDeEnvio, siguienteProvisional } from './sync.js';
import {
  D, cargarDatosLocales, esc, soles, r2, txtPeriodo, txtFecha, hoyISO, metodosPago, buscarClientes, serviciosDe,
  cargosDe, repartir, pppoeDisponibles, plantilla, enlaceWhatsApp, claseEstado,
} from './datos.js';

const $ = (s, el = document) => el.querySelector(s);
const vista = () => $('#vista');
let PERFIL = null;
let sincronizando = false;

// ============================================================================
// ARRANQUE
// ============================================================================
async function arrancar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
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
  $('#usuario').textContent = PERFIL.nombre;
  window.addEventListener('hashchange', enrutar);
  enrutar();
  pintarEstado();
}

// ============================================================================
// BARRA DE ESTADO (en línea / sin señal / pendientes)
// ============================================================================
async function pintarEstado() {
  const pend = (await pendientesDeEnvio()).length;
  const ult = await kvGet('ultimaSync');
  const el = $('#estado');
  el.className = 'estado ' + (navigator.onLine ? 'en-linea' : 'sin-senal');
  el.innerHTML = `${navigator.onLine ? '● En línea' : '● Sin señal'}${sincronizando ? ' · sincronizando…' : ''}` +
    ` · <b>${pend}</b> pendiente(s) de envío · act. ${ult ? esc(txtFecha(ult) + ' ' + ult.slice(11, 16)) : '—'}`;
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
  if (!/^#\/(cobrar|corte|reactivar)/.test(h)) enrutar();   // no interrumpir un formulario
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
  document.querySelectorAll('nav.inferior a').forEach((a) => a.classList.toggle('activo', a.dataset.r === ruta));
  const v = { inicio: vInicio, buscar: vBuscar, cliente: vCliente, cobrar: vCobrar, recibo: vRecibo, cola: vCola,
    hoy: vHoy, cortar: vACortar, corte: vCorte, reactivar: vReactivar, cuenta: vCuenta }[ruta] || vInicio;
  window.scrollTo(0, 0);
  Promise.resolve(v(decodeURIComponent(arg || ''))).catch((e) => { vista().innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}

// ---- INICIO ------------------------------------------------------------------------
async function vInicio() {
  const res = Object.values(D.resumen);
  const n = (f) => res.filter(f).length;
  const deuda = res.reduce((s, r) => s + Number(r.DEUDA_VENCIDA || 0), 0);
  const hoy = await cobrosDeHoy();
  vista().innerHTML = `
    <section class="tarjetas">
      <div class="kpi verde"><span>Activos</span><b>${n((r) => r.ESTADO === 'Activo' || r.ESTADO === 'Moroso')}</b></div>
      <div class="kpi rojo"><span>Morosos</span><b>${n((r) => r.ESTADO === 'Moroso')}</b></div>
      <div class="kpi gris"><span>Cortados</span><b>${n((r) => r.ESTADO === 'Cortado')}</b></div>
      <div class="kpi rojo"><span>Deuda vencida</span><b>${soles(deuda)}</b></div>
      <div class="kpi azul doble"><span>Mis cobros de hoy</span><b>${soles(hoy.total)}</b><small>${hoy.items.length} recibo(s)</small></div>
    </section>
    <a class="btn grande verde" href="#/buscar">💵 COBRAR</a>
    <div class="botones">
      <a class="btn" href="#/buscar">🔎 Buscar cliente</a>
      <a class="btn" href="#/cortar">✂ A cortar (${n((r) => /CORTAR/.test(r.ALERTA || ''))})</a>
      <a class="btn" href="#/cola">📤 Cola de envío</a>
      <a class="btn" href="#/hoy">🧾 Mis cobros de hoy</a>
    </div>
    <button class="btn secundario" id="btnSync">⟳ Sincronizar ahora</button>`;
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
  const wsp = enlaceWhatsApp(c.TELEFONO, plantilla('MsgCobranza', id));
  vista().innerHTML = `
    <section class="ficha">
      <h2>${esc(c.NOMBRES)}</h2>
      <p class="sub">${esc(id)} · DNI/RUC ${esc(c.DNI_RUC)} · <span class="chip ${claseEstado(r.ESTADO)}">${esc(r.ESTADO)}</span></p>
      <div class="deuda ${Number(r.DEUDA_VENCIDA) > 0 ? 'roja' : 'verde'}">
        <span>Deuda vencida</span><b>${soles(r.DEUDA_VENCIDA)}</b><small>${r.MESES_ADEUDA || 0} mes(es) · ${r.DIAS_ATRASO || 0} días de atraso${r.ALERTA ? ' · ' + esc(r.ALERTA) : ''}</small>
      </div>
      ${enCola.length ? `<p class="aviso">⏳ ${enCola.length} operación(es) de este cliente en cola de envío.</p>` : ''}
      <a class="btn grande verde" href="#/cobrar/${esc(id)}">💵 COBRAR</a>
      <div class="botones">
        ${c.TELEFONO ? `<a class="btn" href="tel:${esc(c.TELEFONO)}">📞 Llamar</a>` : ''}
        ${wsp ? `<a class="btn" href="${esc(wsp)}" target="_blank" rel="noopener">💬 Recordatorio</a>` : ''}
      </div>
      <h3>Datos</h3>
      <dl>
        <dt>Teléfono</dt><dd>${esc(c.TELEFONO)}${c.TELEFONO2 ? ' / ' + esc(c.TELEFONO2) : ''}</dd>
        <dt>Dirección</dt><dd>${esc(c.DIRECCION)}${c.REFERENCIA ? ' (Ref.: ' + esc(c.REFERENCIA) + ')' : ''}</dd>
        <dt>Zona</dt><dd>${esc(c.ZONA)}</dd>
        ${c.COORDENADAS ? `<dt>Mapa</dt><dd><a href="https://maps.google.com/?q=${encodeURIComponent(c.COORDENADAS)}" target="_blank" rel="noopener">📍 ${esc(c.COORDENADAS)}</a></dd>` : ''}
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
          ${s.ESTADO === 'Cortado' || s.ESTADO === 'Suspendido' ? `<a class="mini verde" href="#/reactivar/${esc(s.ID_SERV)}">Reactivar</a>` : ''}</div>
        </div>`).join('') || '<p class="vacio">Sin servicios</p>'}
      <h3>Últimos pagos</h3>
      <ul class="lista compacta">${pagos.map((p) => `<li><div><b>${esc(p.N_RECIBO)}</b><small>${esc(txtFecha(p.FECHA))} · ${esc(p.METODO)} · ${esc(p.PERIODOS)}</small></div>
        <div class="der">${soles(p.MONTO)}${p.ESTADO === 'Anulado' ? '<small class="error">ANULADO</small>' : ''}</div></li>`).join('') || '<li class="vacio">Sin pagos recientes</li>'}</ul>
    </section>`;
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
      <label>Observación<input id="obs" maxlength="200" placeholder="Opcional (ej.: pagó solo el cable)"></label>
      <button class="btn grande verde" id="btnCobrar">REGISTRAR COBRO</button>
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
  $('#metodo').onchange = () => { $('#opWrap').style.display = $('#metodo').value === 'Efectivo' ? 'none' : ''; };
  $('#metodo').onchange();
  recalc();

  $('#btnCobrar').onclick = async () => {
    const sel = cajas().filter((x) => x.checked && !x.closest('label').hidden);
    const monto = r2($('#monto').value || 0), t = total(), metodo = $('#metodo').value;
    if (!sel.length) return aviso('Marque al menos un mes.', 'error');
    if (!(monto > 0)) return aviso('Ingrese el monto recibido.', 'error');
    if (monto > t + 0.004) return aviso('El monto supera lo seleccionado.', 'error');
    if (metodo !== 'Efectivo' && !$('#operacion').value.trim() &&
        !confirm(`No ingresó N° de operación de ${metodo}. ¿Registrar de todos modos?`)) return;
    const cargosSel = D.cargos.filter((k) => sel.some((x) => x.value === k.ID_CARGO))
      .sort((a, b) => String(a.PERIODO).localeCompare(String(b.PERIODO)));
    const reparto = repartir(cargosSel, monto);
    if (!confirm(`Registrar ${soles(monto)}${monto < t - 0.004 ? ' (PARCIAL)' : ''} de ${c.NOMBRES}\nMétodo: ${metodo}\n` +
        reparto.map((x) => `· ${txtPeriodo(x.cargo.PERIODO)}: ${soles(x.aplicado)}${x.parcial ? ' (parcial)' : ''}`).join('\n'))) return;
    $('#btnCobrar').disabled = true;
    const op = {
      tipo: 'COBRO', idCliente: id, cargos: cargosSel.map((k) => k.ID_CARGO), monto, metodo,
      operacion: $('#operacion').value.trim(), obs: $('#obs').value.trim(), fechaPago: hoyISO(),
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
  const wsp = enlaceWhatsApp(v.telefono, texto);
  vista().innerHTML = `
    <section class="recibo ${rech ? 'rechazado' : ''}">
      <div class="cab"><b>${esc(cfg.Negocio || 'D@NDINET')}</b><span>${oficial ? 'RECIBO DE PAGO' : 'RECIBO PROVISIONAL'}</span>
        <strong>N° ${esc(nro)}</strong></div>
      ${rech ? `<p class="error">${res.aRevisar ? '⚠ A REVISAR: ' : 'RECHAZADO: '}${esc(res.mensaje)}</p>` : ''}
      ${!oficial && !rech ? `<p class="aviso">${op.estadoLocal === 'pendiente' ? '⏳ Pendiente de envío (sin señal o enviando…).' : '⏳ Enviado, esperando respuesta.'} El número oficial llegará al sincronizar.</p>` : ''}
      <dl><dt>Fecha</dt><dd>${esc(txtFecha(op.fechaPago))}</dd><dt>Cliente</dt><dd>${esc(v.cliente)}</dd>
        <dt>DNI/RUC</dt><dd>${esc(v.doc)}</dd><dt>Atendió</dt><dd>${esc(v.usuario)}</dd></dl>
      <table><thead><tr><th>Periodo</th><th>Detalle</th><th>Pagado</th></tr></thead><tbody>
        ${v.detalle.map((d) => `<tr><td>${esc(d.periodo)}</td><td>${esc(d.concepto)}${d.parcial ? ' <small>(parcial)</small>' : ''}</td><td>${soles(d.aplicado)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totalr">TOTAL <b>${soles(op.monto)}</b></div>
      <p class="sub">${esc(op.metodo)}${op.operacion ? ' · Op. ' + esc(op.operacion) : ''}</p>
      ${res.mensaje && oficial ? `<p class="sub">${esc(res.mensaje)}</p>` : ''}
      <p class="pie">Recibo interno de control de pagos. No es comprobante SUNAT.</p>
      ${wsp && !rech ? `<a class="btn grande verde" href="${esc(wsp)}" target="_blank" rel="noopener">💬 Enviar por WhatsApp</a>` : ''}
      <a class="btn" href="#/cliente/${esc(op.idCliente)}">Volver al cliente</a>
      <a class="btn secundario" href="#/inicio">Inicio</a>
    </section>`;
}

// ---- COLA DE ENVÍO -------------------------------------------------------------------
async function vCola() {
  const cola = (await colaTodos()).sort((a, b) => String(b.fDispositivo).localeCompare(String(a.fDispositivo))).slice(0, 150);
  const etiqueta = { pendiente: '⏳ Pendiente', enviado: '📨 Enviado', ok: '✅ Listo', rechazado: '⚠ Rechazado', error: '❗ Error' };
  vista().innerHTML = `<h2>Cola de envío</h2>
    <button class="btn" id="btnSync">⟳ Enviar ahora</button>
    <ul class="lista">${cola.map((o) => {
      const res = o.resultado || {}, cli = D.porId[o.idCliente] || {};
      const titulo = o.tipo === 'COBRO' ? `Cobro ${soles(o.monto)} · ${cli.NOMBRES || o.idCliente}` : `${o.tipo} ${o.idServ || ''} · ${cli.NOMBRES || ''}`;
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
  vista().innerHTML = `<h2>Mis cobros de hoy · ${esc(txtFecha(hoyISO()))}</h2>
    <div class="kpi azul doble"><span>Total cobrado</span><b>${soles(total)}</b><small>${items.length} recibo(s)</small></div>
    <table class="resumen"><tbody>${Object.entries(porMetodo).map(([m, v]) => `<tr><td>${esc(m)}</td><td>${soles(v)}</td></tr>`).join('')}</tbody></table>
    <ul class="lista">${items.map((x) => `<li><a href="${x.id ? '#/recibo/' + esc(x.id) : '#/hoy'}"><div><b>${esc(x.nro)}</b><small>${esc(x.cliente)} · ${esc(x.metodo)}</small></div>
      <div class="der">${soles(x.monto)}${x.estado !== 'ok' ? '<small>⏳ sin enviar</small>' : ''}</div></a></li>`).join('') || '<li class="vacio">Aún no hay cobros hoy.</li>'}</ul>`;
}

// ---- A CORTAR ------------------------------------------------------------------------
function vACortar() {
  const lista = Object.values(D.resumen).filter((r) => /CORTAR/.test(r.ALERTA || '')).sort((a, b) => Number(b.DIAS_ATRASO) - Number(a.DIAS_ATRASO));
  vista().innerHTML = `<h2>Clientes a cortar (${lista.length})</h2>
    <p class="sub">Regla: ${esc(D.config.DiasCorte || 30)} días o más de atraso.</p>
    <ul class="lista">${lista.map((r) => `<li><a href="#/cliente/${esc(r.ID_CLIENTE)}"><div><b>${esc(r.NOMBRES)}</b>
      <small>${esc(r.ID_CLIENTE)} · ${esc(r.ZONA)} · ${r.DIAS_ATRASO} días · PPPoE ${esc(r.PPPOE || '-')}</small></div>
      <div class="der"><b class="error">${soles(r.DEUDA_VENCIDA)}</b></div></a></li>`).join('') || '<li class="vacio">Nadie para cortar.</li>'}</ul>`;
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
    if (!confirm(`¿${$('#acc').selectedOptions[0].text.split(' (')[0]} de ${s.CLIENTE}?`)) return;
    await encolar({ tipo: $('#acc').value, idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, motivo, fecha: hoyISO(), cobrarMesCorte: $('#cobrarMes').checked });
    aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    const c = D.porId[s.ID_CLIENTE];
    const wsp = c && enlaceWhatsApp(c.TELEFONO, plantilla('MsgCorte', s.ID_CLIENTE));
    if (wsp && $('#acc').value === 'CORTAR' && confirm('¿Avisar al cliente por WhatsApp?')) window.open(wsp, '_blank', 'noopener');
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
    if (!confirm(`¿Reactivar ${s.ID_SERV} de ${s.CLIENTE}?`)) return;
    await encolar({ tipo: 'REACTIVAR', idServ: s.ID_SERV, idCliente: s.ID_CLIENTE, codigoPPPoE: $('#ppp').value,
      tarifa: $('#tarifa').value, motivo: $('#motivo').value.trim() || 'Reactivación', fecha: hoyISO() });
    aviso(navigator.onLine ? 'Enviado. Se aplicará en segundos.' : 'Guardado sin señal: se enviará al volver la conexión.');
    location.hash = '#/cliente/' + s.ID_CLIENTE;
  };
}

// ---- CUENTA ----------------------------------------------------------------------------
async function vCuenta() {
  const pend = (await pendientesDeEnvio()).length;
  vista().innerHTML = `<section class="form"><h2>Mi cuenta</h2>
    <p><b>${esc(PERFIL.nombre)}</b><br><small>${esc(PERFIL.email)} · ${esc(PERFIL.rol)}</small></p>
    <p class="sub">Versión ${CONFIG.VERSION}. Datos del ${esc(txtFecha(D.generado))} ${esc(String(D.generado || '').slice(11, 16))}.</p>
    <button class="btn" id="btnSync">⟳ Sincronizar ahora</button>
    <button class="btn rojo" id="salir">Cerrar sesión</button>
    ${pend ? `<p class="aviso error">Tiene ${pend} operación(es) sin enviar. Sincronice antes de cerrar sesión.</p>` : ''}</section>`;
  $('#btnSync').onclick = sincronizarManual;
  $('#salir').onclick = async () => {
    if (pend && !confirm(`Hay ${pend} operación(es) SIN ENVIAR que se perderían. ¿Cerrar sesión de todos modos?`)) return;
    if (!confirm('Se borrarán los datos guardados en este celular. ¿Continuar?')) return;
    cerrarSesionGoogle();
    await borrarTodo();
    location.hash = '';
    location.reload();
  };
}

window.addEventListener('DOMContentLoaded', arrancar);
