# Ekuatia Login (extensión Chrome/Edge)

Puente exclusivo entre **Control Clientes** y el formulario de acceso de
Marangatu. No tiene popup, buscador, importador de CSV ni funcionamiento
independiente.

Al pulsar el botón Marangatu de una tarjeta, Control Clientes envía el `R.U.C.`
y la `Clave MH` mediante mensajería externa de Chromium. El service worker abre
la página oficial de acceso e inyecta los datos una sola vez.

## Instalar

1. Abrí `chrome://extensions` (o `edge://extensions`).
2. Activá **Modo de desarrollador**.
3. Elegí **Cargar descomprimida** y seleccioná esta carpeta `Extension/`.
4. Copiá el ID que aparece debajo del nombre de la extensión.

Después de modificar sus archivos, usá el botón **Recargar** de la extensión en
esa misma pantalla.

## Conectar con Control Clientes

1. En el `.env` local de Control Clientes configurá
   `VITE_MARANGATU_EXT_ID=<ID de la extensión>`.
2. Reiniciá `npm run dev` o generá nuevamente la aplicación.
3. Usá el botón Marangatu desde una tarjeta de cliente.

El ID no debe escribirse directamente en el código fuente. En una extensión
cargada de forma descomprimida puede variar entre computadoras.

## Origen autorizado

Durante el desarrollo, la extensión admite mensajes solamente desde
`http://localhost:3000`. El manifest declara `http://localhost/*` porque los
patrones de Chrome no aceptan puertos, pero el service worker vuelve a validar
el origen completo y rechaza cualquier otro puerto.

Antes de compilar la aplicación para PC se añadirá el origen local exacto de su
página puente, por ejemplo `http://127.0.0.1:PUERTO`. No debe agregarse un
comodín de dominios ni un puerto ficticio antes de definir ese componente.

## Permisos

- `scripting`: inyecta el RUC y la clave únicamente en el formulario de
  Marangatu.
- `tabs`: abre la página oficial y espera a que termine de cargar.
- `host_permissions`: limita la inyección a `https://marangatu.set.gov.py/*`.

## Seguridad

- La extensión no usa `localStorage`, `chrome.storage` ni archivos CSV.
- No conserva listas de clientes ni credenciales.
- El RUC y la clave existen temporalmente en memoria durante la apertura del
  formulario; no se colocan en la URL, el historial ni el portapapeles.
- `externally_connectable.matches` no admite sandboxes ni dominios con comodín;
  además, el service worker exige que el origen declarado y la URL remitente
  coincidan con la lista interna de orígenes exactos.
- Si un CSV con contraseñas fue compartido o versionado anteriormente, las
  claves afectadas deben rotarse y el archivo debe eliminarse también del
  historial correspondiente.

> La mensajería directa con la extensión funciona en Chrome, Edge y otros
> navegadores Chromium. Sin la extensión, Control Clientes abre Marangatu para
> realizar el acceso manual.
