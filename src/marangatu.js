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
