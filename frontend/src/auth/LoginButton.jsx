import { useAuth0 } from "@auth0/auth0-react";

export default function LoginButton() {
  const { isAuthenticated, isLoading, user, loginWithRedirect, logout } = useAuth0();

  if (isLoading) {
    return (
      <button type="button" className="auth-btn" disabled>
        Cargando…
      </button>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="auth-bar">
        {user?.name && <span className="auth-user">{user.name}</span>}
        <button
          type="button"
          className="auth-btn auth-btn--ghost"
          onClick={() =>
            logout({ logoutParams: { returnTo: window.location.origin } })
          }
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="auth-btn"
      onClick={() => loginWithRedirect()}
    >
      Iniciar sesión
    </button>
  );
}
