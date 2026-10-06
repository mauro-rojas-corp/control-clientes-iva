// Formulario 120 (IVA) de Marangatu: correspondencia de casillas y las dos
// funciones que el popup inyecta en la página (en todos sus frames).
//
// MAPA_CASILLAS: casilla -> selector CSS del campo en Marangatu. Se completa
// a partir del listado que genera "Relevar formulario". Mientras una casilla
// no esté en el mapa, se intenta reconocerla por id/name/data-casilla con
// nombres del tipo "casilla10", "cas_10" o "c10"; si no aparece, se informa
// como "no encontrada" y no se escribe nada en otro campo.
// eslint-disable-next-line no-unused-vars -- lo usa popup.js
const MAPA_CASILLAS = {
  // '10': '#ejemplo_casilla_10',
};

// Formato del importe al escribirlo: 'plano' = 1000000, 'miles' = 1.000.000.
// eslint-disable-next-line no-unused-vars -- lo usa popup.js
const FORMATO_IMPORTE = 'plano';

// --- Funciones inyectadas (serializadas por executeScript: autocontenidas) ---

// Escribe cada casilla en su campo. Nunca envía ni presenta el formulario.
// Devuelve { completadas, calculadas, faltantes } para este frame.
// eslint-disable-next-line no-unused-vars -- lo usa popup.js
function completarFormulario120(casillas, mapa, formato) {
  const res = { completadas: [], calculadas: [], faltantes: [] };
  // Setter nativo: así Angular/React (si los usa Marangatu) ven el cambio.
  const escribir = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) desc.set.call(el, v);
    else el.value = v;
  };
  const texto = (n) => (formato === 'miles'
    ? (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(n));

  const buscar = (cas) => {
    if (mapa[cas]) return document.querySelector(mapa[cas]);
    const rx = new RegExp('^(casilla|cas|c)[_-]?0*' + cas + '$', 'i');
    return [...document.querySelectorAll('input')].find((el) =>
      rx.test(el.id || '') || rx.test(el.name || '') || rx.test(el.dataset.casilla || '')
    ) || null;
  };

  casillas.forEach(({ cas, valor }) => {
    const el = buscar(cas);
    if (!el || el.type === 'password' || el.type === 'hidden') {
      res.faltantes.push(cas);
      return;
    }
    // Campos que el propio formulario calcula: se dejan como están.
    if (el.readOnly || el.disabled) {
      res.calculadas.push(cas);
      return;
    }
    el.focus();
    escribir(el, texto(valor));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.style.outline = '2px solid #e0a800';
    el.style.backgroundColor = '#fff3b0';
    el.title = 'Completado por Ekuatia Login (casilla ' + cas + '): revisá antes de presentar';
    res.completadas.push(cas);
  });
  return res;
}

// Lista los campos del formulario SIN sus valores (ni contraseñas), para
// armar MAPA_CASILLAS. Devuelve un objeto por frame.
// eslint-disable-next-line no-unused-vars -- lo usa popup.js
function relevarFormulario() {
  const corto = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const campos = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.type !== 'password' && el.type !== 'hidden')
    .map((el) => {
      const label = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
      const fila = el.closest('tr') || el.parentElement;
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        clase: corto(el.className, 80),
        placeholder: corto(el.placeholder, 60),
        aria: corto(el.getAttribute('aria-label'), 80),
        label: corto(label && label.innerText, 120),
        contexto: corto(fila && fila.innerText, 160),
        soloLectura: Boolean(el.readOnly || el.disabled),
      };
    });
  return {
    pagina: location.origin + location.pathname,
    titulo: corto(document.title, 120),
    encabezados: [...document.querySelectorAll('h1, h2, h3, legend')].map((h) => corto(h.innerText, 100)).filter(Boolean).slice(0, 40),
    campos,
  };
}
