# Atril — lector de partituras

PWA para iPhone (Safari iOS 17+) que fotografía o importa partituras, las limpia en el propio
dispositivo y permite leerlas cómodamente en tres modos (página, sistemas y compases). Funciona
100 % sin conexión; ningún dato sale del teléfono.

## Requisitos de desarrollo (Windows)

- Node.js ≥ 22 y npm
- `npm install`
- Navegadores de prueba: `npx playwright install webkit chromium`

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo accesible en la red local (`vite --host`) |
| `npm run build` | Comprobación de tipos + build de producción en `dist/` |
| `npm run preview` | Sirve `dist/` (con service worker) en la red local |
| `npm test` | Tests unitarios (Vitest) |
| `npm run e2e` | Tests E2E (Playwright, WebKit con emulación de iPhone) |
| `npm run tunnel` | Túnel HTTPS con cloudflared hacia `localhost:5173` |

## Probar en el iPhone desde Windows

La cámara, el service worker y la instalación exigen **HTTPS**. Hay tres opciones:

### A. Túnel cloudflared (recomendado, sin certificados)

1. Instala cloudflared: `winget install --id Cloudflare.cloudflared`
2. En una terminal: `npm run dev`
3. En otra: `npm run tunnel` → copia la URL `https://….trycloudflare.com` que aparece.
4. Ábrela en Safari en el iPhone.

Para probar el modo offline/instalación con el service worker real usa `npm run build && npm run preview`
y `cloudflared tunnel --url http://localhost:4173`.

### B. mkcert (red local, sin internet)

1. `winget install FiloSottile.mkcert` y `mkcert -install`
2. `mkdir certs && mkcert -key-file certs/key.pem -cert-file certs/cert.pem <IP-de-tu-PC> localhost`
3. `npm run dev`: Vite usa automáticamente `certs/` si existe → `https://<IP-de-tu-PC>:5173`.
4. En el iPhone instala la CA raíz: copia `%LOCALAPPDATA%\mkcert\rootCA.pem` al iPhone (AirDrop/correo),
   instala el perfil y actívalo en *Ajustes → General → Información → Ajustes de confianza de certificados*.

### C. GitHub Pages

Cada push a `main` ejecuta los tests y despliega en `https://<usuario>.github.io/<repo>/`.

## Despliegue en GitHub Pages (una sola vez)

1. Crea un repositorio vacío en GitHub (p. ej. `atril`).
2. `git remote add origin https://github.com/<usuario>/<repo>.git && git push -u origin main`
3. En el repositorio: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
4. El workflow `.github/workflows/deploy.yml` compila con `BASE_PATH=/<repo>/` automáticamente.

## Instalar en el iPhone

1. Abre la URL en **Safari**.
2. Botón Compartir → **Añadir a pantalla de inicio**.
3. Abre Atril desde el icono una vez con conexión; a partir de ahí funciona en modo avión.

## Depuración en el iPhone

Safari para iOS no se puede inspeccionar desde Windows. En *Ajustes → Modo diagnóstico* se activa una
consola integrada (Eruda) y el panel del pipeline (`#/diag`). En `npm run dev` siempre está activo.

## Créditos

Las partituras de `bench/fixtures/real/` son de dominio público (Wikimedia Commons); ver `CREDITOS.txt`.
