// Configuración de la app. No hay secretos aquí: la seguridad la da el servidor
// (verifica el inicio de sesión con Google en cada llamada).
export const CONFIG = {
  VERSION: '1.15.0',
  API_URL: 'https://script.google.com/macros/s/AKfycbwGvdL1wnv0pcNxiFYNxmhz24RzcYe42WnvvTyTHN_cUmBF5PZQCRcVxqjRbKAeJEpN/exec',
  CLIENT_ID: '223370778430-gbs0o6ge9noqlpiig72bv9ak3n9iialc.apps.googleusercontent.com',
  SYNC_CADA_MIN: 3,          // con la app abierta y con señal, sincroniza cada N minutos
  LOTE_ENVIO: 20,            // operaciones por envío
};
