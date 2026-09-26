import { createContext, useContext, useEffect, useState } from "react";
import { Auth0Provider } from "@auth0/auth0-react";
import { fetchAuthConfig } from "../api/client";

const AuthAvailability = createContext(false);

export function useAuthAvailable() {
  return useContext(AuthAvailability);
}

export default function AuthProvider({ children }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuthConfig()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config?.domain || !config?.clientId) {
    return <AuthAvailability.Provider value={false}>{children}</AuthAvailability.Provider>;
  }

  return (
    <AuthAvailability.Provider value={true}>
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
    </AuthAvailability.Provider>
  );
}
