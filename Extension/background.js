// Service worker del puente "Ekuatia Login".
//
// Atiende exclusivamente pedidos externos de Control Clientes. La app manda
// { user, pass } por un canal en memoria; acá se abre el login de Marangatu y
// se inyecta una sola vez. La extensión no persiste listas ni credenciales, y
// éstas nunca se colocan en la URL, el historial ni el portapapeles.
const LOGIN_URL = 'https://marangatu.set.gov.py/eset/login';

// El manifest de Chrome no permite restringir un patrón por puerto. Por eso
// allí se declara localhost y acá se exige el origen completo. Cuando exista
// el puente de la app compilada, se agregará su origen 127.0.0.1:PUERTO exacto.
const ALLOWED_APP_ORIGINS = new Set(['http://localhost:3000']);

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== 'APP_AUTO_LOGIN') return false;

  const senderOrigin = getVerifiedSenderOrigin(sender);
  if (!senderOrigin || !ALLOWED_APP_ORIGINS.has(senderOrigin)) {
    sendResponse({ ok: false, error: 'origen no autorizado' });
    return false;
  }

  const user = String(msg.user || '').trim();
  const pass = String(msg.pass || '');
  if (!user) {
    sendResponse({ ok: false, error: 'sin usuario' });
    return true;
  }

  chrome.tabs.create({ url: LOGIN_URL }, (tab) => {
    const tabId = tab.id;

    const inject = (attempts) => {
      chrome.scripting.executeScript(
        { target: { tabId }, func: inyectarLogin, args: [user, pass] },
        () => {
          // Si la página todavía no está lista, reintenta unas veces.
          if (chrome.runtime.lastError && attempts > 0) {
            setTimeout(() => inject(attempts - 1), 400);
          }
        }
      );
    };

    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        setTimeout(() => inject(3), 300);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });

  sendResponse({ ok: true });
  return true;
});

// Chrome informa tanto el origen como la URL de la página remitente. Ambos
// valores deben existir y coincidir: no se acepta un fallback permisivo cuando
// falta alguno, porque esta verificación protege la apertura automática.
function getVerifiedSenderOrigin(sender) {
  const declaredOrigin = normalizeHttpOrigin(sender?.origin);
  const urlOrigin = normalizeHttpOrigin(sender?.url);
  if (!declaredOrigin || !urlOrigin || declaredOrigin !== urlOrigin) return '';
  return declaredOrigin;
}

function normalizeHttpOrigin(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

// Se inyecta en la página de login (función serializada por executeScript).
function inyectarLogin(user, pass) {
  const u = document.querySelector(
    "input[type='text'], input[type='email'], input[name*='user'], input[id*='user']"
  );
  const p = document.querySelector(
    "input[type='password'], input[name*='pass'], input[id*='pass']"
  );
  if (!u || !p) return;

  u.value = user;
  u.dispatchEvent(new Event('input', { bubbles: true }));
  p.value = pass;
  p.dispatchEvent(new Event('input', { bubbles: true }));

  setTimeout(() => {
    const btn = document.querySelector("button[type='submit'], input[type='submit']");
    if (btn) btn.click();
  }, 800);
}
