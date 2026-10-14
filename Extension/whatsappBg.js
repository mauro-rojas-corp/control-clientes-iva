// Envío de la ficha de IVA por WhatsApp Web (service worker).
//
// Se carga con importScripts desde background.js y usa de ahí
// ALLOWED_APP_ORIGINS y getVerifiedSenderOrigin.
//
// La app manda APP_WA_ENVIAR con { telefono, texto, imagen (data URL PNG) }.
// La persona revisa y toca Enviar: la extensión NUNCA envía el mensaje.
//
// v2.5 — una sola pestaña de WhatsApp Web:
//  - Si ya hay una abierta (en cualquier ventana de este perfil), se usa ESA:
//    se la lleva al chat del número con el texto escrito y, cuando carga, se
//    pega la imagen. Nunca se abre una segunda pestaña.
//  - Sólo si no hay ninguna se abre una nueva.
// WhatsApp no ofrece otra forma confiable de abrir el chat de un número
// cualquiera: por eso la pestaña recarga al cambiar de chat. (La 2.4 probó
// abrirlo con un enlace interno, pero WhatsApp Web lo abre en otra pestaña,
// donde no se pegaba la imagen.)
//
// No hay content script permanente en WhatsApp Web: la función se inyecta
// sólo en la pestaña de este envío. El pedido pendiente vive en
// chrome.storage.session (memoria del navegador) y vence a los 3 minutos.
const WA_HOST = 'web.whatsapp.com';
const WA_KEY = 'waPendiente';
const WA_TTL_MS = 3 * 60 * 1000;
const WA_MAX_IMAGEN = 12 * 1024 * 1024;

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.action !== 'APP_WA_ENVIAR') return false;
  const origen = getVerifiedSenderOrigin(sender);
  if (!origen || !ALLOWED_APP_ORIGINS.has(origen)) {
    sendResponse({ ok: false, error: 'WA_ORIGEN' });
    return false;
  }
  const pedido = validarPedidoWa(msg);
  if (pedido.error) {
    sendResponse({ ok: false, error: pedido.error });
    return false;
  }
  abrirChatWa(pedido).then(sendResponse, (e) => sendResponse({ ok: false, error: 'WA_ERROR', detalle: String(e && e.message || e) }));
  return true;
});

function validarPedidoWa(msg) {
  const telefono = String(msg.telefono || '').replace(/\D/g, '');
  const texto = String(msg.texto || '').slice(0, 1500);
  const imagen = String(msg.imagen || '');
  if (!/^\d{8,15}$/.test(telefono)) return { error: 'WA_TELEFONO' };
  if (!imagen.startsWith('data:image/png;base64,')) return { error: 'WA_IMAGEN' };
  if (imagen.length > WA_MAX_IMAGEN) return { error: 'WA_IMAGEN_GRANDE' };
  const nombre = String(msg.nombre || 'ficha.png').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '').slice(0, 120) || 'ficha.png';
  return { telefono, texto, imagen, nombre };
}

// La pestaña de WhatsApp Web que conviene reutilizar: la activa de la última
// ventana usada, si la hay; si no, cualquiera de este perfil.
async function buscarPestanaWa() {
  const abiertas = await chrome.tabs.query({ url: 'https://' + WA_HOST + '/*' });
  if (!abiertas.length) return null;
  let ventana = null;
  try { ventana = await chrome.windows.getLastFocused(); } catch { /* sin ventana */ }
  return abiertas.find((t) => ventana && t.windowId === ventana.id && t.active) ||
    abiertas.find((t) => ventana && t.windowId === ventana.id) ||
    abiertas.find((t) => t.active) ||
    abiertas[0];
}

async function abrirChatWa(pedido) {
  const url = 'https://' + WA_HOST + '/send?phone=' + pedido.telefono + '&text=' + encodeURIComponent(pedido.texto);
  const existente = await buscarPestanaWa();
  let tab;
  if (existente) {
    // El pedido se guarda ANTES de navegar, para que el "complete" de la carga
    // siempre lo encuentre.
    await guardarPendiente(pedido, existente.id);
    tab = await chrome.tabs.update(existente.id, { url, active: true });
  } else {
    tab = await chrome.tabs.create({ url, active: true });
    await guardarPendiente(pedido, tab.id);
  }
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* sin ventana */ }
  return { ok: true, reutilizada: !!existente };
}

function guardarPendiente(pedido, tabId) {
  return chrome.storage.session.set({
    [WA_KEY]: { ...pedido, tabId, inyectado: false, expiresAt: Date.now() + WA_TTL_MS },
  });
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

// Inyectada en WhatsApp Web (autocontenida). Espera el cuadro de mensaje del
// chat (hasta 2 minutos: puede hacer falta escanear el QR), pega la imagen
// como si se hubiera hecho Ctrl+V y avisa en la página. Si WhatsApp todavía no
// tomó el pegado, reintenta. No envía nada.
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
    '#main footer div[contenteditable="true"], [data-testid="conversation-compose-box-input"], footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"]'
  );
  // La vista previa (editor de adjuntos) aparece al tomar el pegado: muestra
  // la imagen como blob: nuevo o abre un diálogo/capa con la imagen.
  const contarVistas = () => document.querySelectorAll('img[src^="blob:"]').length;

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

  let archivo;
  try {
    const blob = await (await fetch(imagen)).blob();
    archivo = new File([blob], nombre, { type: 'image/png' });
  } catch {
    aviso('No se pudo preparar la imagen. Está en el portapapeles: pegala con Ctrl+V.', false);
    return { ok: false, error: 'PEGAR' };
  }

  // El texto llega por el enlace y WhatsApp lo escribe un instante después
  // de mostrar el cuadro; se espera a que esté (o hasta 3 s) antes de pegar.
  for (let i = 0; i < 12 && !(cuadro.innerText || '').trim(); i++) await esperar(250);
  await esperar(500);

  // Hasta 2 intentos: a veces WhatsApp ignora el primer pegado si el chat
  // todavía se está terminando de montar.
  for (let intento = 0; intento < 2; intento++) {
    cuadro = buscarCuadro() || cuadro;
    const antes = contarVistas();
    try {
      const dt = new DataTransfer();
      dt.items.add(archivo);
      cuadro.focus();
      cuadro.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {
      break;
    }
    for (let i = 0; i < 10; i++) {
      await esperar(400);
      // Si el cuadro de mensaje desapareció, se abrió el editor de adjuntos.
      if (contarVistas() > antes || !document.contains(cuadro)) {
        aviso('Imagen lista con el texto: revisá y tocá Enviar.', true);
        return { ok: true };
      }
    }
  }
  aviso('Si la imagen no aparece, pegala con Ctrl+V (está en el portapapeles).', false);
  return { ok: false, error: 'SIN_VISTA_PREVIA' };
}
