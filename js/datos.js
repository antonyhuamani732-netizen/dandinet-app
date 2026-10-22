// Datos sincronizados en memoria + reglas de cálculo del lado del celular.
// La verdad SIEMPRE la tiene el servidor; aquí solo se prepara lo que se muestra y
// se calcula una vista previa (que el servidor vuelve a validar).
import { kvGet } from './db.js';

export const D = {
  clientes: [], privados: {}, resumen: {}, servicios: [], cargos: [], pppoe: [], histPPPoE: [], suspensiones: [], ordenes: [], ordenesDet: [], planes: [], listas: [], pagos: [],
  config: {}, generado: null, porId: {},
};

/** {cols, filas} → lista de objetos */
const aObjetos = (t) => (t && t.filas ? t.filas.map((f) => Object.fromEntries(t.cols.map((c, i) => [c, f[i]]))) : []);

export async function cargarDatosLocales() {
  const s = await kvGet('datos');
  if (!s) return false;
  aplicar(s);
  return true;
}

export function aplicar(s) {
  D.clientes = aObjetos(s.clientes);
  D.privados = Object.fromEntries(aObjetos(s.privados).map((p) => [p.ID_CLIENTE, p]));
  D.resumen = Object.fromEntries(aObjetos(s.resumen).map((r) => [r.ID_CLIENTE, r]));
  D.servicios = aObjetos(s.servicios);
  D.cargos = aObjetos(s.cargos);
  D.pppoe = aObjetos(s.pppoe);
  D.histPPPoE = aObjetos(s.histPPPoE);
  D.suspensiones = aObjetos(s.suspensiones);
  // órdenes de trabajo / hojas de ruta (desde la v1.11); DATOS y SNAPSHOT vienen como texto JSON
  const json = (t) => { try { return JSON.parse(t || '{}'); } catch (e) { return {}; } };
  D.ordenes = aObjetos(s.ordenes).map((o) => Object.assign(o, { DATOS: json(o.DATOS) }));
  D.ordenesDet = aObjetos(s.ordenesDet).map((d) => Object.assign(d, { SNAPSHOT: json(d.SNAPSHOT) }));   // pausas vacacionales (desde la v1.10)   // quién usó cada código (llega desde la v1.8)
  D.planes = aObjetos(s.planes);
  D.listas = aObjetos(s.listas);
  D.pagos = aObjetos(s.pagos);
  D.config = s.config || {};
  D.generado = s.generado;
  D.porId = Object.fromEntries(D.clientes.map((c) => [c.ID_CLIENTE, c]));
}

// ---- utilidades de formato ------------------------------------------------------
export const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
export const soles = (x) => 'S/ ' + r2(x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
export const txtPeriodo = (iso) => { const s = String(iso || ''); return s.length >= 7 ? MESES[Number(s.slice(5, 7)) - 1] + '-' + s.slice(0, 4) : s; };
export const txtFecha = (iso) => { const s = String(iso || ''); return s.length >= 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; };
/** Fecha de hoy en Lima como aaaa-mm-dd */
/**
 * Mora para mostrar: hasta 30 días → "18 días"; más de 30 → meses de CALENDARIO desde el
 * vencimiento (respeta el día de pago de cada cliente). Ej.: venció el 04/08, hoy 16/10 → "2 meses".
 */
export function txtMora(dias) {
  const d = Math.max(0, Math.floor(Number(dias) || 0));
  if (d <= 30) return d === 1 ? '1 día' : d + ' días';
  const hoy = new Date(hoyISO() + 'T12:00:00'), venc = new Date(hoy);
  venc.setDate(venc.getDate() - d);
  let m = (hoy.getFullYear() - venc.getFullYear()) * 12 + (hoy.getMonth() - venc.getMonth());
  if (hoy.getDate() < venc.getDate()) m--;
  m = Math.max(1, m);
  return m === 1 ? '1 mes' : m + ' meses';
}

/**
 * Prorrateo de cambio de plan (igual que el servidor, calculoProrrateoPlan). El día del cambio cuenta con el plan nuevo.
 * Monto del mes = días transcurridos × (actual / días del mes) + días restantes × (nueva / días del mes).
 */
export function prorrateoPlan(tarifaActual, tarifaNueva, fechaISO) {
  const [a, m, d] = String(fechaISO).slice(0, 10).split('-').map(Number);
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const restantes = diasMes - d + 1, transcurridos = d - 1;
  const montoMes = r2(tarifaActual * transcurridos / diasMes + tarifaNueva * restantes / diasMes);
  return { diasMes, transcurridos, restantes, montoMes, ajuste: r2(montoMes - tarifaActual),
    conActual: r2(tarifaActual * transcurridos / diasMes), conNueva: r2(tarifaNueva * restantes / diasMes) };
}

export const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
export const ahoraISO = () => {
  const d = new Date(), f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const g = (t) => f.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}-05:00`;
};
export const metodosPago = () => {
  const l = D.listas.filter((x) => x.TIPO === 'METODO' && x.ACTIVO !== 'No' && x.VALOR !== 'MIGRADO').map((x) => x.VALOR);
  return l.length ? l : ['Efectivo', 'Yape', 'Plin', 'Transferencia', 'Depósito'];
};

// ---- clientes ------------------------------------------------------------------------
export function buscarClientes(texto, max = 80) {
  const palabras = String(texto || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const c of D.clientes) {
    const r = D.resumen[c.ID_CLIENTE] || {};
    const s = `${c.ID_CLIENTE} ${c.NOMBRES} ${c.DNI_RUC} ${r.PPPOE || ''} ${c.TELEFONO} ${c.ZONA}`.toUpperCase();
    if (palabras.every((p) => s.includes(p))) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export const serviciosDe = (id) => D.servicios.filter((s) => s.ID_CLIENTE === id);

/**
 * Nombre del servicio sin la velocidad: "SERVICIO DE INTERNET 20mbp" → "SERVICIO DE INTERNET".
 * Igual que nombreServicio en apps-script/Utils.gs (si cambia uno, cambie el otro).
 */
export const nombreServicio = (plan) => String(plan || '')
  .replace(/\s*\d+(?:[.,]\d+)?\s*(?:mbps|mbp|mb|megas?)\b\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
/**
 * Paquete DUO de un cliente (INTERNET + CATV que actúan como uno): servicios no dados de baja, por plan.
 * Devuelve { internet: [serv], catv: [serv], todos: [serv] } o null si el cliente no tiene ambos.
 * Igual que serviciosDuo en apps-script/Duo.gs (si cambia uno, cambie el otro).
 */
export function serviciosDuo(idCliente) {
  const inet = [], catv = [];
  D.servicios.filter((s) => s.ID_CLIENTE === idCliente && s.ESTADO !== 'Baja').forEach((s) => {
    const n = nombreServicio(s.PLAN);
    if (/CATV/i.test(n) && !/INTERNET/i.test(n)) catv.push(s);
    else if (/INTERNET/i.test(n)) inet.push(s);
  });
  return inet.length && catv.length ? { internet: inet, catv, todos: inet.concat(catv) } : null;
}
/** Texto de un cargo: "SERVICIO DE INTERNET", "SERVICIO DE CATV", "INSTALACION", "AJUSTE PLAN". */
export const nombreCargo = (k) => (k.CONCEPTO === 'MENSUALIDAD' ? nombreServicio(k.PLAN) : String(k.CONCEPTO || ''));
/** Versión corta para filas estrechas: "INTERNET", "CATV". */
export const nombreCorto = (k) => nombreCargo(k).replace(/^SERVICIO\s+(DE\s+)?/i, '');
/** Dentro de un mismo mes: INTERNET primero, luego CATV, luego lo demás. */
const rangoServicio = (t) => (/INTERNET/i.test(t) ? 0 : /CATV|CABLE/i.test(t) ? 1 : 2);
export const ordenCargos = (a, b) => String(a.PERIODO).slice(0, 7).localeCompare(String(b.PERIODO).slice(0, 7)) ||
  rangoServicio(nombreCargo(a)) - rangoServicio(nombreCargo(b)) || String(a.CONCEPTO).localeCompare(String(b.CONCEPTO));

/** Cargos con saldo de un cliente, ordenados por periodo (igual que el servidor). */
export function cargosDe(id) {
  return D.cargos.filter((k) => k.ID_CLIENTE === id && k.ANULADO !== 'Sí' && Number(k.SALDO) > 0.004).sort(ordenCargos);
}

/** "AGO-2026" · "AGO–DIC 2026" · "DIC-2025 a FEB-2026" (ini y fin como "aaaa-mm"). */
export function txtRango(ini, fin) {
  if (!fin || fin === ini) return txtPeriodo(ini);
  if (ini.slice(0, 4) === fin.slice(0, 4)) return MESES[Number(ini.slice(5, 7)) - 1] + '–' + MESES[Number(fin.slice(5, 7)) - 1] + ' ' + ini.slice(0, 4);
  return txtPeriodo(ini) + ' a ' + txtPeriodo(fin);
}
const mesSiguiente = (ym) => { const a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 12 ? (a + 1) + '-01' : a + '-' + String(m + 1).padStart(2, '0'); };

/**
 * Agrupa líneas de un recibo como el servidor (agruparLineasRecibo): mismo servicio y meses seguidos
 * pagados completos → una línea "SERVICIO DE INTERNET · 3 meses" (AGO–OCT 2026). Los parciales van solos.
 * items: [{ per: 'aaaa-mm' (opcional), periodo (texto de respaldo), base, monto, parcial }]
 */
export function agruparLineas(items) {
  const lista = items.slice().sort((x, y) => rangoServicio(x.base) - rangoServicio(y.base) ||
    String(x.base).localeCompare(String(y.base)) || String(x.per || '').localeCompare(String(y.per || '')));
  const out = [];
  for (const it of lista) {
    const u = out[out.length - 1];
    if (u && it.per && u.fin && !u.parcial && !it.parcial && u.base === it.base && it.per === mesSiguiente(u.fin)) {
      u.fin = it.per; u.n++; u.monto = r2(u.monto + Number(it.monto));
    } else out.push({ ini: it.per, fin: it.per, n: 1, base: it.base, monto: r2(it.monto), parcial: !!it.parcial, periodo: it.periodo });
  }
  return out.map((g) => ({ periodo: g.ini ? txtRango(g.ini, g.fin) : g.periodo || '', detalle: g.base + (g.n > 1 ? ' · ' + g.n + ' meses' : ''),
    monto: g.monto, parcial: g.parcial }));
}

/** Reparte el monto del más antiguo al más nuevo (vista previa; el servidor decide). */
export function repartir(cargos, monto) {
  let resto = r2(monto);
  return cargos.map((k) => {
    const apl = r2(Math.max(0, Math.min(Number(k.SALDO), resto)));
    resto = r2(resto - apl);
    return { cargo: k, aplicado: apl, parcial: apl > 0 && apl < r2(k.SALDO) };
  }).filter((x) => x.aplicado > 0);
}

export const pppoeDisponibles = () => D.pppoe.filter((p) => p.ESTADO === 'Disponible').map((p) => p.CODIGO);

/** Reemplaza los marcadores de las plantillas de WhatsApp. */
export function plantilla(clave, idCliente) {
  const c = D.porId[idCliente] || {}, r = D.resumen[idCliente] || {}, cfg = D.config;
  // un mes con INTERNET y CATV se nombra una sola vez
  const periodos = [...new Set(cargosDe(idCliente).filter((k) => Number(k.DIAS_ATRASO) > 0).map((k) => txtPeriodo(k.PERIODO)))].join(', ');
  return String(cfg[clave] || '').replace(/\\n/g, '\n')
    .replace(/{NOMBRE}/g, c.NOMBRES || '').replace(/{DEUDA}/g, soles(r.DEUDA_VENCIDA)).replace(/{MESES}/g, r.MESES_ADEUDA || 0)
    .replace(/{PERIODOS}/g, periodos || '-').replace(/{DIA}/g, cfg.DiaVenc || 4).replace(/{YAPE}/g, cfg.Yape || '')
    .replace(/{TITULAR}/g, cfg.TitularCobro || '').replace(/{BCP}/g, cfg.BCP || '').replace(/{BN}/g, cfg.BN || '')
    .replace(/{NEGOCIO}/g, cfg.Negocio || 'D@NDINET');
}

export function enlaceWhatsApp(telefono, mensaje) {
  let t = String(telefono || '').replace(/\D/g, '');
  if (t.length === 9) t = '51' + t;
  return t.length >= 11 ? `https://wa.me/${t}?text=${encodeURIComponent(mensaje)}` : null;
}

export function claseEstado(e) {
  return { Activo: 'e-activo', Moroso: 'e-moroso', Suspendido: 'e-susp', Cortado: 'e-cortado', Baja: 'e-baja',
    Pagado: 'e-activo', Parcial: 'e-porvencer', Vencido: 'e-moroso', 'Por vencer': 'e-porvencer', Pendiente: 'e-pend' }[e] || 'e-pend';
}
