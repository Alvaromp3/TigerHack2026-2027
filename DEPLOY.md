# Despliegue: frontend en Vercel, API en Render

El frontend (landing, app y página pública) va a **Vercel**. La API y la base de datos siguen en **Render**.
El navegador solo habla con la API; la API es la única que habla con Postgres.

```
Navegador ──> Vercel (frontend estático) ──> https://tigerhack-api.onrender.com (FastAPI) ──> Postgres en Render
```

## Qué ya está preparado

| Archivo | Para qué |
|---|---|
| `vercel.json` (raíz del repo) | Instala y compila `frontend/`, publica `frontend/dist`. Rutas cortas `/app` y `/public`. |
| `frontend/.env.production` | `VITE_API_URL=https://tigerhack-api.onrender.com`, se incluye en el build. |
| `backend/app/core/config.py` | CORS acepta cualquier `https://*.vercel.app` (`cors_origin_regex`). |
| `render.yaml` | Blueprint de la API en Render (ya existía). |

## Variables de entorno

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_API_URL` | Vercel (frontend) | `https://tigerhack-api.onrender.com`. Ya va en `frontend/.env.production`; en Vercel es opcional. |
| `DATABASE_URL` | Backend en local (Docker) | `postgresql+psycopg://tigerhack:tigerhack@localhost:5433/tigerhack`. Es el valor por defecto de `config.py` y está en `backend/.env.example`. |
| `DATABASE_URL` | Render (API) | La **Internal Database URL** de `tigerhack-db`, cambiando `postgresql://` por `postgresql+psycopg://`. |
| `OPENROUTER_API_KEY` | Render (API) | Clave de OpenRouter. Sin ella, el chat muestra "Offline". |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Render (API) | Los de Auth0. El login es opcional; la app funciona sin iniciar sesión. |

> `DATABASE_URL` **no se pone en Vercel**: el frontend nunca se conecta a Postgres, y `localhost:5433` solo existe en tu portátil.

## Pasos (unos 5 minutos)

1. **Subir el código** a GitHub (Vercel y Render despliegan desde `main`):
   ```bash
   git add -A
   git commit -m "EMS demo: ambulances, open data, chat, Vercel deploy"
   git push origin main
   ```
2. **Render (API)**
   - Si el servicio `tigerhack-api` tiene auto-deploy, se redespliega solo con el push. Si no: *Manual Deploy → Deploy latest commit*.
   - Revisa en *Environment* que `DATABASE_URL` es la de Render (no `localhost`) y que `OPENROUTER_API_KEY` está puesta.
   - Comprueba <https://tigerhack-api.onrender.com/api/health>: `"database": {"ok": true}`.
3. **Vercel (frontend)**
   - *Add New → Project → Import* `Alvaromp3/TigerHack2026-2027`.
   - Deja **Root Directory** en `./` (el `vercel.json` de la raíz hace el resto) y pulsa **Deploy**.
   - Opcional: en *Environment Variables* añade `VITE_API_URL = https://tigerhack-api.onrender.com`.
4. **Auth0** (solo si vais a enseñar el login). En la aplicación de Auth0 añade `https://<tu-proyecto>.vercel.app` en *Allowed Callback URLs*, *Allowed Logout URLs* y *Allowed Web Origins*.
5. **Comprobar**
   - `https://<tu-proyecto>.vercel.app/`: landing.
   - `/app.html` (o `/app`): el panel. Ambulances debe mostrar al menos 3 ambulancias en camino.
   - `/public.html` (o `/public`): el tablero público para empresas de ambulancias.

## Lo que la API hace sola al arrancar (también en Render)

- Crea los índices de `flow_events` y la tabla `care_activities` (lo que se le está haciendo a cada paciente ahora mismo: la cirugía en quirófano o el paso de cuidados).
- Completa la plantilla de limpieza hasta 12 limpiadores y 6 de lencería, sin duplicar a nadie, para que cada habitación en limpieza tenga a alguien asignado.
- Las ambulancias **no se aceptan solas**: esperan a que alguien pulse Aceptar. Si nadie responde, al minuto de llegar la tripulación se va a otro hospital (queda como "No answer").

## Antes de presentar

- Render gratis se duerme: abre `/api/health` 1-2 minutos antes para despertarlo.
- Si ves un error de CORS con un dominio propio (no `*.vercel.app`), añádelo a `CORS_ORIGINS` en Render.

## En local

```bash
docker compose up -d db                                  # Postgres en localhost:5433
cd backend && uvicorn app.main:app --reload --port 8000  # API
cd frontend && npm install && npm run dev                # http://localhost:5173
```
Para que el frontend local use tu API local, pon `VITE_API_URL=http://localhost:8000` en `frontend/.env`.
