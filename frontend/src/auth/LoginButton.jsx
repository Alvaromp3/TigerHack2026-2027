import { useAuth0 } from "@auth0/auth0-react";
import { useAuthAvailable } from "./AuthProvider";

function initials(name) {
  const parts = (name || "Tiger Memorial").split(" ").filter(Boolean);
  return (parts[0]?.[0] || "T") + (parts[1]?.[0] || "M");
}

export default function LoginButton() {
  const available = useAuthAvailable();
  if (!available) {
    return (
      <button type="button" className="avatar" title="Sign-in is ready when the API is up" disabled>
        TM
      </button>
    );
  }
  return <AuthLogin />;
}

function AuthLogin() {
  const { isAuthenticated, isLoading, user, loginWithRedirect, logout } = useAuth0();

  if (isLoading) {
    return (
      <button type="button" className="avatar" disabled>
        …
      </button>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="auth-signed">
        <button type="button" className="avatar" title={user?.name || "Account"}>
          {initials(user?.name)}
        </button>
        <button
          type="button"
          className="auth-ghost"
          onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="avatar" onClick={() => loginWithRedirect()} title="Sign in">
      {initials(user?.name)}
    </button>
  );
}
