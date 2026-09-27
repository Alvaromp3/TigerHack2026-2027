import { createContext, useContext, useEffect, useState } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { fetchAuthConfig, setActor } from "../api/client";

const AuthAvailability = createContext(false);

export function useAuthAvailable() {
  return useContext(AuthAvailability);
}

// Keeps the API client's X-Actor header in step with the signed-in user.
function ActorBridge() {
  const { isAuthenticated, user } = useAuth0();
  useEffect(() => {
    setActor(isAuthenticated ? user?.name || user?.email : "");
  }, [isAuthenticated, user]);
  return null;
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
        <ActorBridge />
        {children}
      </Auth0Provider>
    </AuthAvailability.Provider>
  );
}
