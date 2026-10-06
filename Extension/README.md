# Ekuatia Login (extensión Chrome/Edge)

Puente exclusivo entre **Control Clientes** y Marangatu. Hace dos cosas:

1. **Login:** al pulsar el botón Marangatu de un cliente, Control Clientes
   envía el `R.U.C.` y la `Clave MH` por mensajería externa de Chromium. El
   service worker abre la página oficial de acceso e inyecta los datos una
   sola vez.
2. **Formulario 120 (IVA):** desde la ficha IVA del cliente, **Copiar a
   Marangatu** envía las casillas calculadas. Estando en el Formulario 120 de
   Marangatu, el ícono de la extensión → **Completar formulario** las escribe
   en sus campos y las marca en amarillo. **La extensión nunca presenta la
   declaración:** la revisión y el botón "Presentar" son siempre de la
   persona.

## Instalar

1. Abrí `chrome://extensions` (o `edge://extensions`).
2. Activá **Modo de desarrollador**.
3. Elegí **Cargar descomprimida** y seleccioná esta carpeta `Extension/`.
4. Copiá el ID que aparece debajo del nombre de la extensión.
5. Fijá el ícono en la barra (pieza de rompecabezas → alfiler) para tener a
   mano **Completar formulario**.

Después de modificar sus archivos, usá el botón **Recargar** de la extensión en
esa misma pantalla.

## Conectar con Control Clientes

1. En el `.env` local de Control Clientes configurá
   `VITE_MARANGATU_EXT_ID=<ID de la extensión>`.
2. Reiniciá `npm run dev` o generá nuevamente la aplicación.
3. Usá el botón Marangatu desde una tarjeta de cliente, o **Copiar a
   Marangatu** desde su ficha IVA.

El ID no debe escribirse directamente en el código fuente. En una extensión
cargada de forma descomprimida puede variar entre computadoras.

## Formulario 120: correspondencia de casillas

`formulario120.js` tiene `MAPA_CASILLAS` (casilla → selector CSS del campo en
Marangatu) y `FORMATO_IMPORTE`. Mientras una casilla no esté en el mapa, se
intenta reconocer por `id`/`name` del tipo `casilla10`, `cas_10` o `c10`. Si
no aparece, se informa como "no encontrada" y no se escribe en ningún otro
campo. Los campos de sólo lectura (los calcula el formulario) no se tocan.

Para completar el mapa:

1. Iniciá sesión en Marangatu y abrí el Formulario 120 **sin cargar datos**.
2. Ícono de la extensión → **Relevar formulario** → **Copiar listado**.
3. El listado tiene, por cada campo, su `id`, `name`, etiqueta y el texto de
   la fila. **No incluye valores ni contraseñas.** Revisalo antes de
   compartirlo y pasalo a quien mantiene la app para armar el mapa.

Si el formulario está dividido en pasos o pestañas, relevá cada paso.

## Origen autorizado

Durante el desarrollo, la extensión admite mensajes solamente desde
`http://localhost:3000`. El manifest declara `http://localhost/*` porque los
patrones de Chrome no aceptan puertos, pero el service worker vuelve a validar
el origen completo y rechaza cualquier otro puerto.

Antes de usar la app publicada (fuera de localhost) hay que agregar su origen
exacto en `ALLOWED_APP_ORIGINS` (background.js) y en
`externally_connectable.matches` (manifest.json). No debe agregarse un
comodín de dominios ni un puerto ficticio.

## Permisos

- `scripting`: inyecta el login y las casillas únicamente en Marangatu.
- `tabs`: abre la página oficial, espera a que cargue y detecta si la
  pestaña activa es Marangatu.
- `storage`: sólo `chrome.storage.session` para las casillas pendientes.
- `host_permissions`: limita la inyección a `https://marangatu.set.gov.py/*`.

## Seguridad

- **Credenciales:** nunca se guardan. El RUC y la clave existen sólo en
  memoria durante la apertura del login; no se colocan en la URL, el
  historial ni el portapapeles.
- **Casillas del Formulario 120:** se guardan en `chrome.storage.session`,
  que vive en la memoria del navegador (no en disco), se borra al cerrarlo y,
  además, vence a los 30 minutos. **Descartar datos** las elimina antes.
  Sólo se aceptan números (casilla e importe) y un período AAAA-MM válido.
- La extensión no usa `localStorage`, `chrome.storage.local` ni archivos CSV,
  y no conserva listas de clientes.
- `externally_connectable.matches` no admite sandboxes ni dominios con comodín;
  además, el service worker exige que el origen declarado y la URL remitente
  coincidan con la lista interna de orígenes exactos.
- Si un CSV con contraseñas fue compartido o versionado anteriormente, las
  claves afectadas deben rotarse y el archivo debe eliminarse también del
  historial correspondiente.

> La mensajería directa con la extensión funciona en Chrome, Edge y otros
> navegadores Chromium. Sin la extensión, Control Clientes abre Marangatu para
> realizar el acceso manual, y **Copiar lista** deja las casillas en el
> portapapeles para cargarlas a mano.
