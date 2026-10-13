// Envío de la ficha de IVA por WhatsApp Web (service worker).
//
// Se carga con importScripts desde background.js y usa de ahí
// ALLOWED_APP_ORIGINS y getVerifiedSenderOrigin.
//
// La app manda APP_WA_ENVIAR con { telefono, texto, imagen (data URL PNG) }.
// Se abre (o se reutiliza) la pestaña de WhatsApp Web en el chat de ese número
// con el texto escrito y, cuando carga, se pega la imagen en el chat. La
// persona revisa y toca Enviar: la extensión NUNCA envía el mensaje.
//
// No hay content script permanente en WhatsApp Web: la función se inyecta
// sólo en la pestaña de este envío. El pedido pendiente vive en
// chrome.storage.session (memoria del navegador) y vence a los 3 minutos.
const WA_HOST = 'web.whatsapp.com';
const WA_KEY = 'waPendiente';
const WA_TTL_MS = 3 * 60 * 1000;
const WA_MAX_IMAGEN = 8 * 1024 * 1024;

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== 'APP_WA_ENVIAR') return false;
  const origen = getVerifiedSenderOrigin(sender);
  if (!origen || !ALLOWED_APP_ORIGINS.has(origen)) {
    sendResponse({ ok: false, error: 'origen no autorizado' });
    return false;
  }
  const pedido = validarPedidoWa(msg);
  if (!pedido) {
    sendResponse({ ok: false, error: 'datos de WhatsApp inválidos' });
    return false;
  }
  abrirChatWa(pedido).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

function validarPedidoWa(msg) {
  const telefono = String(msg.telefono || '').replace(/\D/g, '');
  const texto = String(msg.texto || '').slice(0, 1500);
  const imagen = String(msg.imagen || '');
  if (!/^\d{8,15}$/.test(telefono)) return null;
  if (!imagen.startsWith('data:image/png;base64,') || imagen.length > WA_MAX_IMAGEN) return null;
  const nombre = String(msg.nombre || 'ficha.png').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '').slice(0, 120) || 'ficha.png';
  return { telefono, texto, imagen, nombre };
}

async function abrirChatWa(pedido) {
  const url = 'https://' + WA_HOST + '/send?phone=' + pedido.telefono + '&text=' + encodeURIComponent(pedido.texto);
  // Una sola pestaña de WhatsApp Web: si ya hay una abierta, se reutiliza
  // (WhatsApp no admite dos sesiones web en el mismo navegador).
  const abiertas = await chrome.tabs.query({ url: 'https://' + WA_HOST + '/*' });
  let tab;
  if (abiertas.length) {
    tab = await chrome.tabs.update(abiertas[0].id, { url, active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* sin ventana */ }
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }
  await chrome.storage.session.set({
    [WA_KEY]: { ...pedido, tabId: tab.id, inyectado: false, expiresAt: Date.now() + WA_TTL_MS },
  });
  return { ok: true };
}

// Cuando la pestaña del envío termina de cargar, se pega la imagen una vez.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  let host = '';
  try { host = new URL(tab.url || '').hostname; } catch { return; }
  if (host !== WA_HOST) return;
  chrome.storage.session.get(WA_KEY, async (data) => {
    const p = data && data[WA_KEY];
    if (!p || p.tabId !== tabId || p.inyectado) return;
    if (p.expiresAt < Date.now()) { await chrome.storage.session.remove(WA_KEY); return; }
    await chrome.storage.session.set({ [WA_KEY]: { ...p, inyectado: true } });
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: pegarImagenWhatsapp, args: [p.imagen, p.nombre] });
    } catch { /* la pestaña se cerró o cambió de sitio */ }
    await chrome.storage.session.remove(WA_KEY);
  });
});

// Inyectada en WhatsApp Web. Espera el cuadro de mensaje del chat (hasta 2
// minutos: puede hacer falta escanear el QR), pega la imagen como si se
// hubiera hecho Ctrl+V y avisa en la página. No envía nada.
async function pegarImagenWhatsapp(imagen, nombre) {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const aviso = (texto, ok) => {
    let box = document.getElementById('ekuatia-wa-aviso');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ekuatia-wa-aviso';
      box.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;max-width:440px;' +
        'padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,Segoe UI,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)';
      document.body.appendChild(box);
    }
    box.style.background = ok ? '#e7f6ee' : '#fff3cd';
    box.style.color = ok ? '#0e5a35' : '#5c4400';
    box.style.border = '2px solid ' + (ok ? '#1f8f4e' : '#e0a800');
    box.textContent = 'Ekuatia · ' + texto;
    clearTimeout(box._t);
    box._t = setTimeout(() => box.remove(), 12000);
  };
  const buscarCuadro = () => document.querySelector(
    'footer div[contenteditable="true"], [data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"]'
  );

  let cuadro = null;
  let avisoQr = false;
  for (let i = 0; i < 240 && !cuadro; i++) {
    cuadro = buscarCuadro();
    if (cuadro) break;
    if (!avisoQr && document.querySelector('canvas[aria-label], [data-ref] canvas, div[data-ref]')) {
      aviso('Vinculá WhatsApp Web escaneando el código QR; después la imagen se pega sola.', false);
      avisoQr = true;
    }
    const dialogo = document.querySelector('[role="dialog"]');
    if (dialogo && /no es v[aá]lido|invalid|isn.t on whatsapp|no est[aá] en whatsapp/i.test(dialogo.innerText || '')) {
      aviso('Ese número no está en WhatsApp. Revisá el número del cliente.', false);
      return { ok: false, error: 'NUMERO_INVALIDO' };
    }
    await esperar(500);
  }
  if (!cuadro) {
    aviso('No se encontró el chat. La imagen está en el portapapeles: pegala con Ctrl+V.', false);
    return { ok: false, error: 'SIN_CHAT' };
  }

  await esperar(900); // que termine de cargar el texto escrito por el enlace
  // Las imágenes ya presentes en la conversación también son blob:; se cuenta
  // cuántas hay para detectar la vista previa nueva.
  const blobsAntes = document.querySelectorAll('img[src^="blob:"]').length;
  try {
    const blob = await (await fetch(imagen)).blob();
    const archivo = new File([blob], nombre, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(archivo);
    cuadro.focus();
    cuadro.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch {
    aviso('No se pudo pegar la imagen. Está en el portapapeles: pegala con Ctrl+V.', false);
    return { ok: false, error: 'PEGAR' };
  }

  // La vista previa de WhatsApp muestra la imagen pegada como un blob: nuevo.
  for (let i = 0; i < 16; i++) {
    await esperar(500);
    if (document.querySelectorAll('img[src^="blob:"]').length > blobsAntes) {
      aviso('Imagen lista: revisá y tocá Enviar.', true);
      return { ok: true };
    }
  }
  aviso('Si la imagen no aparece, pegala con Ctrl+V (está en el portapapeles).', false);
  return { ok: false, error: 'SIN_VISTA_PREVIA' };
}
