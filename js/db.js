// Base de datos LOCAL del celular (IndexedDB): permite trabajar SIN internet.
//  - kv   : datos sincronizados, perfil, token, contadores
//  - cola : operaciones hechas en el celular, pendientes de enviar al servidor
const NOMBRE = 'dandinet', VERSION = 1;
let _db = null;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('cola')) d.createObjectStore('cola', { keyPath: 'idSolicitud' });
    };
    r.onsuccess = () => { _db = r.result; ok(_db); };
    r.onerror = () => mal(r.error);
  });
}

async function tx(store, modo, fn) {
  const d = await abrir();
  return new Promise((ok, mal) => {
    const t = d.transaction(store, modo), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => ok(req && 'result' in req ? req.result : undefined);
    t.onerror = () => mal(t.error);
  });
}

export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k));
export const colaPut = (op) => tx('cola', 'readwrite', (s) => s.put(op));
export const colaTodos = () => tx('cola', 'readonly', (s) => s.getAll());
export const colaBorrar = (id) => tx('cola', 'readwrite', (s) => s.delete(id));

/** Borra TODO lo guardado en el celular (al cerrar sesión). */
export async function borrarTodo() {
  await tx('kv', 'readwrite', (s) => s.clear());
  await tx('cola', 'readwrite', (s) => s.clear());
}
