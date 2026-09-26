import { useEffect, useState } from "react";
import { fetchHealth } from "./api/client";
import LoginButton from "./auth/LoginButton";
import "./App.css";

export default function App() {
  const [status, setStatus] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    fetchHealth()
      .then((data) => {
        if (!cancelled) setStatus({ loading: false, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus({
            loading: false,
            data: null,
            error: err.message || "No se pudo conectar al backend",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <div className="top-bar">
        <LoginButton />
      </div>

      <header className="hero">
        <p className="brand">Health Hackathon</p>
        <h1>Plantilla lista para construir</h1>
        <p className="lede">
          React + Vite en el frontend, FastAPI en el backend. Agreguen aquí su idea de
          salud cuando la tengan.
        </p>
      </header>

      <section className="status" aria-live="polite">
        <h2>Estado del API</h2>
        {status.loading && <p>Conectando con el backend…</p>}
        {status.error && (
          <p className="error">
            {status.error}. Arranquen el backend en el puerto 8000.
          </p>
        )}
        {status.data && (
          <pre>{JSON.stringify(status.data, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
