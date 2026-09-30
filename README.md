# Hackathon Template — Health

Plantilla lista para un hackathon de **salud**. Frontend React + Vite, backend FastAPI.
La idea del producto la agregan ustedes; esto solo arranca el stack.

## Estructura

```
hackathon-template/
├── frontend/     # React + Vite
└── backend/      # FastAPI
```

## Requisitos

- **Node.js** 18+ (para el frontend)
- **Python** 3.10+ (para el backend)

## Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API: http://localhost:8000  
Docs: http://localhost:8000/docs

## Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

## Notas

- El frontend llama a `GET /api/health` del backend (proxy en Vite).
- Login con Auth0: el frontend pide `GET /api/auth/config` (domain + clientId). El **client secret nunca sale del backend**.
- En Auth0 Application → Settings, usa `http://localhost:5173` en Callback URLs, Logout URLs, Web Origins y CORS.
- CORS ya está configurado para desarrollo local.
- Carpetas vacías con `.gitkeep` están listas para modelos, servicios, páginas, etc.

## Auth0 (variables en `backend/.env`)

```
AUTH0_DOMAIN=tu-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
```
