// Envío de la ficha de IVA por WhatsApp Web (service worker).
//
// Se carga con importScripts desde background.js y usa de ahí
// ALLOWED_APP_ORIGINS y getVerifiedSenderOrigin.
//
// La app manda APP_WA_ENVIAR con { telefono, texto, imagen (data URL PNG) }.
// La persona revisa y toca Enviar: la extensión NUNCA envía el mensaje.
//
// Dos caminos (v2.4):
//  1. WhatsApp Web ya está abierto: NO se recarga la pestaña. Se inyecta un
//     script que abre el chat del número desde la propia interfaz de WhatsApp
//     (enlace interno, como cuando se toca un wa.me dentro de un chat), escribe
//     el texto y pega la imagen. Así no se repite la carga y sincronización de
//     WhatsApp Web en cada envío.
//  2. No hay pestaña abierta, o el camino 1 no pudo abrir el chat: se abre
//     web.whatsapp.com/send?phone=… (carga completa) y, cuando termina de
//     cargar, se pega la imagen. Es el comportamiento de la v2.2.
//
// Seguridad: el camino 1 sólo pega si comprueba que el chat cambió después de
// pedir el del número. Si no puede comprobarlo, usa el camino 2 en vez de
// arriesgarse a pegar la ficha en el chat de otro cliente.
//
// No hay content script permanente en WhatsApp Web: la función se inyecta
// sólo en la pestaña de este envío. El pedido pendiente del camino 2 vive en
// chrome.storage.session (memoria del navegador) y vence a los 3 minutos.
const WA_HOST = 'web.whatsapp.com';
const WA_KEY = 'waPendiente';
const WA_TTL_MS = 3 * 60 * 1000;
const WA_MAX_IMAGEN = 8 * 1024 * 1024;
// Errores del camino 1 que indican que el chat no se abrió: se pasa al camino 2.
const WA_ERRORES_REINTENTO = new Set(['NO_LISTO', 'SIN_CAMBIO', 'SIN_CHAT', 'EXCEPCION']);

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
  enviarFichaWa(pedido).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
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

async function enviarFichaWa(pedido) {
  // Una sola pestaña de WhatsApp Web: si ya hay una abierta, se reutiliza
  // (WhatsApp no admite dos sesiones web en el mismo navegador).
  const abiertas = await chrome.tabs.query({ url: 'https://' + WA_HOST + '/*' });
  const tab = abiertas.find((t) => t.status === 'complete') || null;
  if (!tab) return abrirChatWaRecargando(pedido, abiertas[0] || null);

  try { await chrome.tabs.update(tab.id, { active: true }); } catch { /* pestaña cerrada */ }
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* sin ventana */ }

  // Se responde a la app enseguida; el trabajo sigue en segundo plano.
  abrirChatWaSinRecargar(pedido, tab).catch(() => abrirChatWaRecargando(pedido, tab));
  return { ok: true, modo: 'misma-pestana' };
}

async function abrirChatWaSinRecargar(pedido, tab) {
  let resultado = null;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: operarWhatsapp,
      args: [{ abrirChat: true, telefono: pedido.telefono, texto: pedido.texto, imagen: pedido.imagen, nombre: pedido.nombre }],
    });
    resultado = r && r.result;
  } catch {
    resultado = { ok: false, error: 'EXCEPCION' };
  }
  if (!resultado || WA_ERRORES_REINTENTO.has(resultado.error)) {
    await abrirChatWaRecargando(pedido, tab);
  }
}

// Camino 2: carga completa de web.whatsapp.com/send. El texto va en la URL y
// la imagen se pega cuando la pestaña termina de cargar (onUpdated, abajo).
async function abrirChatWaRecargando(pedido, tabExistente) {
  const url = 'https://' + WA_HOST + '/send?phone=' + pedido.telefono + '&text=' + encodeURIComponent(pedido.texto);
  let tab;
  if (tabExistente) {
    tab = await chrome.tabs.update(tabExistente.id, { url, active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* sin ventana */ }
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }
  await chrome.storage.session.set({
    [WA_KEY]: { ...pedido, tabId: tab.id, inyectado: false, expiresAt: Date.now() + WA_TTL_MS },
  });
  return { ok: true, modo: 'recarga' };
}

// Cuando la pestaña del camino 2 termina de cargar, se pega la imagen una vez.
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
      await chrome.scripting.executeScript({
        target: { tabId },
        func: operarWhatsapp,
        args: [{ abrirChat: false, imagen: p.imagen, nombre: p.nombre }],
      });
    } catch { /* la pestaña se cerró o cambió de sitio */ }
    await chrome.storage.session.remove(WA_KEY);
  });
});

// Inyectada en WhatsApp Web (debe ser autocontenida).
// - abrirChat: true  → camino 1: abre el chat del número sin recargar,
//   escribe el texto y pega la imagen. Si no puede confirmar que se abrió el
//   chat pedido devuelve NO_LISTO / SIN_CAMBIO sin tocar nada.
// - abrirChat: false → camino 2: el chat ya viene abierto por la URL; espera
//   el cuadro de mensaje (hasta 2 minutos: puede hacer falta escanear el QR)
//   y pega la imagen.
// Nunca envía nada.
async function operarWhatsapp(op) {
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
    '#main footer div[contenteditable="true"], [data-testid="conversation-compose-box-input"], footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]'
  );
  const numeroInvalido = () => {
    const dialogo = document.querySelector('[role="dialog"]');
    return !!(dialogo && /no es v[aá]lido|invalid|isn.t on whatsapp|no est[aá] en whatsapp/i.test(dialogo.innerText || ''));
  };
  const cabeceraChat = () => {
    const h = document.querySelector('#main header');
    return h ? (h.innerText || '').trim() : '';
  };
  const pegar = (cuadro, dt) => {
    cuadro.focus();
    cuadro.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  };

  // ---- Camino 1: abrir el chat dentro de WhatsApp Web, sin recargar ----
  if (op.abrirChat) {
    // WhatsApp Web tiene que estar listo (lista de chats visible). Si no, que
    // el service worker use la carga completa.
    if (!document.querySelector('#pane-side, #side')) return { ok: false, error: 'NO_LISTO' };

    const mainAntes = document.querySelector('#main');
    const cabeceraAntes = cabeceraChat();

    // Enlace interno: WhatsApp Web intercepta los enlaces de chat y abre la
    // conversación en la misma página. Si nadie lo intercepta, se cancela la
    // navegación para no recargar y se informa SIN_CAMBIO.
    const href = 'https://api.whatsapp.com/send?phone=' + op.telefono;
    const enlace = document.createElement('a');
    enlace.href = href;
    enlace.rel = 'noopener noreferrer';
    enlace.style.display = 'none';
    let interceptado = false;
    const vigilar = (e) => {
      if (e.target !== enlace) return;
      if (e.defaultPrevented) interceptado = true;
      else e.preventDefault();
    };
    window.addEventListener('click', vigilar, false);
    (document.querySelector('#app') || document.body).appendChild(enlace);
    try {
      enlace.click();
    } finally {
      window.removeEventListener('click', vigilar, false);
      enlace.remove();
    }
    if (!interceptado) return { ok: false, error: 'SIN_CAMBIO' };

    // Confirmar que se abrió OTRO chat (o que reapareció el panel): si el
    // chat pedido ya era el abierto, no hay forma de distinguirlo de un
    // fallo, así que se prefiere la carga completa a pegar en el chat
    // equivocado.
    let abierto = false;
    for (let i = 0; i < 24; i++) {
      await esperar(250);
      if (numeroInvalido()) {
        aviso('Ese número no está en WhatsApp. Revisá el número del cliente.', false);
        return { ok: false, error: 'NUMERO_INVALIDO' };
      }
      const main = document.querySelector('#main');
      if (main && buscarCuadro() && (main !== mainAntes || cabeceraChat() !== cabeceraAntes)) {
        abierto = true;
        break;
      }
    }
    if (!abierto) return { ok: false, error: 'SIN_CAMBIO' };

    await esperar(600); // que WhatsApp termine de montar el borrador del chat
    const cuadro = buscarCuadro();
    if (!cuadro) return { ok: false, error: 'SIN_CHAT' };

    // Texto: si WhatsApp ya lo trajo, no se duplica.
    const texto = String(op.texto || '');
    const yaEsta = texto && (cuadro.innerText || '').includes(texto.slice(0, 25));
    if (texto && !yaEsta) {
      try {
        const dtTexto = new DataTransfer();
        dtTexto.setData('text/plain', texto);
        pegar(cuadro, dtTexto);
        await esperar(400);
      } catch { /* sigue con la imagen; el texto queda en el portapapeles de la app */ }
    }
  }

  // ---- Espera del cuadro de mensaje (camino 2) ----
  let cuadro = buscarCuadro();
  let avisoQr = false;
  for (let i = 0; i < 240 && !cuadro; i++) {
    if (!avisoQr && document.querySelector('canvas[aria-label], [data-ref] canvas, div[data-ref]')) {
      aviso('Vinculá WhatsApp Web escaneando el código QR; después la imagen se pega sola.', false);
      avisoQr = true;
    }
    if (numeroInvalido()) {
      aviso('Ese número no está en WhatsApp. Revisá el número del cliente.', false);
      return { ok: false, error: 'NUMERO_INVALIDO' };
    }
    await esperar(500);
    cuadro = buscarCuadro();
  }
  if (!cuadro) {
    aviso('No se encontró el chat. La imagen está en el portapapeles: pegala con Ctrl+V.', false);
    return { ok: false, error: 'SIN_CHAT' };
  }
  if (!op.abrirChat) await esperar(900); // que termine de cargar el texto escrito por el enlace

  // ---- Pegar la imagen ----
  // Las imágenes ya presentes en la conversación también son blob:; se cuenta
  // cuántas hay para detectar la vista previa nueva.
  const blobsAntes = document.querySelectorAll('img[src^="blob:"]').length;
  try {
    const blob = await (await fetch(op.imagen)).blob();
    const archivo = new File([blob], op.nombre, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(archivo);
    pegar(cuadro, dt);
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
