// Tema elegido (Día / Noche) antes de pintar, para que no parpadee.
// Va en archivo aparte (no en línea en index.html) para que la política de seguridad (CSP) pueda prohibir scripts en línea.
try { var t = localStorage.getItem('tema'); if (t === 'dia' || t === 'noche') document.documentElement.dataset.tema = t; } catch (e) {}
