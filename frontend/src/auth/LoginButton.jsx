import { useAuth0 } from "@auth0/auth0-react";
import { useAuthAvailable } from "./AuthProvider";

function BuildingIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 21h18" />
      <path d="M6 21V5h8v16" />
      <path d="M14 21V10h4v11" />
      <path d="M10 5.4V8M8.75 6.7h2.5" />
      <path d="M9 12h2M9 15.5h2" />
    </svg>
  );
}

function ProfileButton({ onClick, title, disabled }) {
  return (
    <button
      type="button"
      className="profile-btn"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-label={title || "Account"}
    >
      <BuildingIcon />
    </button>
  );
}

export default function LoginButton() {
  const available = useAuthAvailable();
  if (!available) {
    return <ProfileButton title="Tiger Memorial — sign-in ready when the API is up" disabled />;
  }
  return <AuthLogin />;
}

function AuthLogin() {
  const { isAuthenticated, isLoading, user, loginWithRedirect, logout } = useAuth0();

  if (isLoading) {
    return <ProfileButton title="Loading…" disabled />;
  }

  if (isAuthenticated) {
    return (
      <div className="auth-signed">
        <ProfileButton title={user?.name || "Account"} />
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

  return <ProfileButton title="Sign in" onClick={() => loginWithRedirect()} />;
}
