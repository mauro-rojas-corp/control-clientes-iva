// Service worker del puente "Ekuatia Login".
//
// Atiende exclusivamente pedidos externos de Control Clientes:
//  - APP_AUTO_LOGIN: la app manda { user, pass }; se abre el login de
//    Marangatu y se inyecta una sola vez.
//  - APP_IVA_PREPARE: la app manda las casillas del Formulario 120 de un
//    cliente. Se guardan en chrome.storage.session (memoria del navegador,
//    se borra al cerrarlo) con vencimiento, hasta que desde el popup se
//    pulsa "Completar formulario". Si vienen credenciales, además abre el
//    login como APP_AUTO_LOGIN.
// Las credenciales nunca se guardan, ni se colocan en la URL, el historial
// o el portapapeles.
const LOGIN_URL = 'https://marangatu.set.gov.py/eset/login';
const IVA_STORAGE_KEY = 'ivaPendiente';
const IVA_TTL_MS = 30 * 60 * 1000;
const MAX_CASILLAS = 120;

// El manifest de Chrome no permite restringir un patrón por puerto. Por eso
// allí se declara localhost y acá se exige el origen completo. Cuando exista
// el puente de la app compilada, se agregará su origen 127.0.0.1:PUERTO exacto.
const ALLOWED_APP_ORIGINS = new Set(['http://localhost:3000']);

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.action !== 'APP_AUTO_LOGIN' && msg.action !== 'APP_IVA_PREPARE')) return false;

  const senderOrigin = getVerifiedSenderOrigin(sender);
  if (!senderOrigin || !ALLOWED_APP_ORIGINS.has(senderOrigin)) {
    sendResponse({ ok: false, error: 'origen no autorizado' });
    return false;
  }

  const user = String(msg.user || '').trim();
  const pass = String(msg.pass || '');

  if (msg.action === 'APP_AUTO_LOGIN') {
    if (!user) {
      sendResponse({ ok: false, error: 'sin usuario' });
      return true;
    }
    abrirLogin(user, pass);
    sendResponse({ ok: true });
    return true;
  }

  // APP_IVA_PREPARE
  const pendiente = validarIva(msg);
  if (!pendiente) {
    sendResponse({ ok: false, error: 'datos del formulario inválidos' });
    return true;
  }
  chrome.storage.session.set({ [IVA_STORAGE_KEY]: pendiente }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: 'no se pudieron guardar los datos' });
      return;
    }
    // Después del login (automático o a mano) entra a "Presentar Declaración".
    if (user) abrirLogin(user, pass, irAPresentarCuandoEntre);
    else chrome.tabs.create({ url: LOGIN_URL }, (tab) => irAPresentarCuandoEntre(tab.id));
    sendResponse({ ok: true });
  });
  return true;
});

// Espera a que la pestaña salga del login y, en la página de inicio, entra a
// "Presentar Declaración" (enlace recibirDDJJContribuyente.do, cuyo token
// _cyp es de la sesión: se toma del propio enlace de la página). Se rinde a
// los 3 minutos o cuando ya entró. No completa ni presenta nada.
const PRESENTAR_TIMEOUT_MS = 3 * 60 * 1000;

function irAPresentarCuandoEntre(tabId) {
  const limite = Date.now() + PRESENTAR_TIMEOUT_MS;
  const onUpdated = (id, info, tab) => {
    if (id !== tabId || info.status !== 'complete') return;
    if (Date.now() > limite) {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      return;
    }
    const url = String(tab.url || '');
    if (url.includes('/login') || url.includes('recibirDDJJContribuyente.do')) {
      if (url.includes('recibirDDJJContribuyente.do')) chrome.tabs.onUpdated.removeListener(onUpdated);
      return;
    }
    chrome.scripting.executeScript(
      { target: { tabId }, func: abrirPresentarDeclaracion },
      (res) => {
        if (!chrome.runtime.lastError && res && res[0] && res[0].result) {
          chrome.tabs.onUpdated.removeListener(onUpdated);
        }
      }
    );
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
}

// Inyectada en Marangatu: navega (en la misma pestaña) al enlace de
// "Presentar Declaración" si está en la página. Devuelve si lo encontró.
function abrirPresentarDeclaracion() {
  const link = document.querySelector('a[href*="recibirDDJJContribuyente.do"]')
    || [...document.querySelectorAll('a')].find((a) =>
      /presentar declaraci/i.test(a.title || a.getAttribute('data-tooltip') || ''));
  if (!link || !link.href) return false;
  location.href = link.href;
  return true;
}

// Sólo números: casilla (1 a 4 dígitos) e importe entero en guaraníes.
function validarIva(msg) {
  const periodo = String(msg.periodo || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return null;
  if (!Array.isArray(msg.casillas) || !msg.casillas.length || msg.casillas.length > MAX_CASILLAS) return null;
  const casillas = [];
  for (const c of msg.casillas) {
    const cas = String(c && c.cas);
    const valor = Number(c && c.valor);
    if (!/^\d{1,4}$/.test(cas) || !Number.isFinite(valor) || !Number.isInteger(valor)) return null;
    casillas.push({ cas, valor });
  }
  return {
    ruc: String(msg.ruc || '').replace(/\D/g, '').slice(0, 12),
    nombre: String(msg.nombre || '').slice(0, 120),
    periodo,
    casillas,
    expiresAt: Date.now() + IVA_TTL_MS,
  };
}

// despues(tabId): opcional, se llama con la pestaña abierta (ej. para seguir
// hasta "Presentar Declaración" una vez iniciada la sesión).
function abrirLogin(user, pass, despues) {
  chrome.tabs.create({ url: LOGIN_URL }, (tab) => {
    const tabId = tab.id;
    if (despues) despues(tabId);

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
}

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
