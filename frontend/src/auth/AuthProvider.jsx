import { useEffect, useState } from "react";
import { Auth0Provider } from "@auth0/auth0-react";
import { fetchAuthConfig } from "../api/client";

export default function AuthProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchAuthConfig()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "No se pudo cargar Auth0");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <p className="lede">
          Arranca el backend y asegúrate de tener AUTH0_DOMAIN y AUTH0_CLIENT_ID en
          backend/.env
        </p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="page">
        <p>Cargando Auth0…</p>
      </div>
    );
  }

  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
      }}
      cacheLocation="localstorage"
    >
      {children}
    </Auth0Provider>
  );
}
