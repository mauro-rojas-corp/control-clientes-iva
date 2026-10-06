// Puente con la extensión "Ekuatia Login" (Marangatu / SET).
//
// Abre el login de la SET y, si la extensión está instalada y configurada
// (MARANGATU_EXT_ID), le pasa las credenciales por mensajería externa: un
// canal en memoria que nunca las deja en la URL, el historial ni el
// portapapeles. Si no hay extensión, igual abre la página para cargar el
// login a mano.
import { MARANGATU_LOGIN_URL, MARANGATU_EXT_ID } from './config';

export function openMarangatuLogin({ user, pass }) {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (MARANGATU_EXT_ID && runtime?.sendMessage) {
    try {
      runtime.sendMessage(MARANGATU_EXT_ID, { action: 'APP_AUTO_LOGIN', user, pass }, (resp) => {
        if (runtime.lastError || !resp?.ok) {
          window.open(MARANGATU_LOGIN_URL, '_blank', 'noopener');
        }
      });
      return 'extension';
    } catch {
      // cae al fallback de navegador
    }
  }
  window.open(MARANGATU_LOGIN_URL, '_blank', 'noopener');
  return 'browser';
}

// Le pasa a la extensión las casillas del Formulario 120 de un cliente. La
// extensión las guarda sólo en memoria (chrome.storage.session, con
// vencimiento) hasta que se pulsa "Completar formulario" en Marangatu, y
// abre el login con las credenciales si vienen. Resuelve { ok, error }.
export function sendIvaToMarangatu({ ruc, nombre, periodo, casillas, credentials }) {
  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!MARANGATU_EXT_ID || !runtime?.sendMessage) {
    return Promise.resolve({ ok: false, error: 'NO_EXTENSION' });
  }
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(
        MARANGATU_EXT_ID,
        {
          action: 'APP_IVA_PREPARE',
          ruc,
          nombre,
          periodo,
          casillas: casillas.map(({ cas, valor }) => ({ cas, valor })),
          user: credentials?.user || '',
          pass: credentials?.pass || '',
        },
        (resp) => {
          if (runtime.lastError) resolve({ ok: false, error: 'NO_EXTENSION' });
          else resolve(resp?.ok ? { ok: true } : { ok: false, error: resp?.error || 'ERROR' });
        }
      );
    } catch {
      resolve({ ok: false, error: 'NO_EXTENSION' });
    }
  });
}
