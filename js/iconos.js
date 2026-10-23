// ÍCONOS DE LÍNEA (SVG propio, trazo 1.8, color = currentColor)
// Uso en HTML: <i class="ic" data-ic="cobrar"></i>  → se rellena solo (observador).
// Uso en JS:   ic('cobrar')  → devuelve el <svg> como texto.
// Son decorativos (aria-hidden): el texto del botón siempre acompaña al ícono.
const P = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/>',
  cola: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  recibo: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11.5h6M9 15.5h3.5"/>',
  mas: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  cobrar: '<path d="M4 7V6a2 2 0 0 1 2-2h11v3"/><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M21 11.5h-4a2 2 0 0 0 0 4h4"/>',
  cortar: '<circle cx="6" cy="6" r="2.8"/><circle cx="6" cy="18" r="2.8"/><path d="M20 4 8.2 15.8M14.6 14.6 20 20M8.2 8.2 12 12"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.7-4.4L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.7 4.4l1.3-1.9M20 20v-4.5h-4.5"/>',
  telefono: '<path d="M5 3.5h3.5l2 5L8 10a11.5 11.5 0 0 0 6 6l1.5-2.5 5 2V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.9A8.5 8.5 0 1 1 21 12z"/>',
  editar: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>',
  ubicacion: '<path d="M12 21s7-6.1 7-11.5a7 7 0 1 0-14 0C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  documento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  camara: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  alerta: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  celular: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  descargar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  ver: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  agregar: '<path d="M12 5v14M5 12h14"/>',
  enviado: '<path d="M21.5 2.5 11 13M21.5 2.5 15 21l-4-8-8-4z"/>',
  listo: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.8"/>',
  router: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M11 16.5h.01M12 13V9.5M8.6 7a4.8 4.8 0 0 1 6.8 0M6.1 4.4a8.3 8.3 0 0 1 11.8 0"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  nuevoCliente: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
  ajustes: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  mapa: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
  grafico: '<path d="M3.5 20.5h17M6.5 17v-5M11.5 17V7M16.5 17v-8"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cerrar: '<path d="M6 6l12 12M18 6 6 18"/>',
  flecha: '<path d="m9 6 6 6-6 6"/>',
  atras: '<path d="m15 6-6 6 6 6"/>',
  compartir: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  anular: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  abajo: '<path d="m6 9 6 6 6-6"/>',
  puntos: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  llave: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  calculadora: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  tv: '<rect x="3" y="6.5" width="18" height="12" rx="2"/><path d="m8.5 2.5 3.5 4 3.5-4M8 21.5h8"/>',
  campana: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
  wifi: '<path d="M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/>',
};

export function ic(nombre, clase = '') {
  const p = P[nombre];
  if (!p) return '';
  return `<svg class="ic ${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
}

/** Rellena todos los <i class="ic" data-ic="..."> dentro de raiz. */
export function pintarIconos(raiz = document) {
  raiz.querySelectorAll('i.ic[data-ic]').forEach((el) => {
    const svg = ic(el.dataset.ic, el.className.replace(/\bic\b/, '').trim());
    if (svg) el.outerHTML = svg;
  });
}

/** Observa la página: cualquier ícono nuevo se dibuja solo. */
export function observarIconos() {
  pintarIconos(document);
  new MutationObserver((cambios) => {
    for (const c of cambios) for (const n of c.addedNodes) if (n.nodeType === 1) {
      if (n.matches && n.matches('i.ic[data-ic]')) pintarIconos(n.parentNode || document);
      else if (n.querySelector && n.querySelector('i.ic[data-ic]')) pintarIconos(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
