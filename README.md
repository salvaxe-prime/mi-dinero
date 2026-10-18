# Mi Dinero

App web (PWA) para administrar tu dinero con bolsillos y porcentajes. Se instala en el iPhone desde Safari y funciona sin internet. Los datos se guardan solo en el celular de cada persona.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La página |
| `styles.css` | El diseño |
| `app.js` | Toda la lógica (bolsillos, rendimientos, dólares, respaldo) |
| `manifest.webmanifest` | Nombre e ícono de la app al instalarla |
| `sw.js` | Hace que funcione sin internet |
| `icons/` | Íconos de la app |

## Probarla en la computadora

```
python -m http.server 8000
```
y abre http://localhost:8000

## Publicarla en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `mi-dinero`) y sube todos estos archivos.
2. En el repositorio: **Settings → Pages → Branch: `main` / `(root)` → Save**.
3. En un par de minutos tendrás el link: `https://TU-USUARIO.github.io/mi-dinero/`

## Instalar en iPhone

1. Abre el link en **Safari**.
2. Toca **Compartir** → **Agregar a inicio**.
3. Usa siempre la app desde ese ícono (los datos de Safari y los de la app del inicio son independientes).

## Actualizar la app

Cuando cambies cualquier archivo, sube el número de `CACHE` en `sw.js` (por ejemplo `mi-dinero-v2`) para que los celulares descarguen la nueva versión.
