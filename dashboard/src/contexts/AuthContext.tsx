import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  changeDashboardPassword,
  clearCsrfToken,
  fetchAuthSession,
  loginWithPassword,
  logoutFromDashboard,
} from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";

export type AuthStatus =
  | "loading"
  | "needs_proxy"
  | "unconfigured"
  | "unauthenticated"
  | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  username: string | null;
  error: string | null;
  isAuthenticated: boolean;
  authConfigured: boolean;
  refreshSession: () => Promise<void>;
  login: (username: string, password: string, baseUrlOverride?: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { proxyUrl } = useProxyConnection();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshSession(): Promise<void> {
    if (!proxyUrl) {
      clearCsrfToken();
      setStatus("needs_proxy");
      setUsername(null);
      setError(null);
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const session = await fetchAuthSession(proxyUrl);
      if (session.authenticated) {
        setStatus("authenticated");
        setUsername(session.username);
        return;
      }

      setUsername(null);
      setStatus(session.auth_configured ? "unauthenticated" : "unconfigured");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not reach the proxy";
      setStatus("unauthenticated");
      setUsername(null);
      setError(message);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, [proxyUrl]);

  useEffect(() => {
    const handleAuthRequired = () => {
      void refreshSession();
    };

    window.addEventListener("govyn-auth-required", handleAuthRequired);
    return () => window.removeEventListener("govyn-auth-required", handleAuthRequired);
  }, [proxyUrl]);

  async function login(
    nextUsername: string,
    password: string,
    baseUrlOverride?: string
  ): Promise<void> {
    const effectiveBaseUrl = baseUrlOverride ?? proxyUrl;
    if (!effectiveBaseUrl) {
      setStatus("needs_proxy");
      setError("Proxy URL not configured");
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const session = await loginWithPassword(nextUsername, password, effectiveBaseUrl);
      setStatus("authenticated");
      setUsername(session.username);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not sign in";
      setStatus("unauthenticated");
      setUsername(null);
      setError(message);
    }
  }

  async function logout(): Promise<void> {
    try {
      await logoutFromDashboard(proxyUrl);
    } finally {
      setStatus(proxyUrl ? "unauthenticated" : "needs_proxy");
      setUsername(null);
      setError(null);
    }
  }

  async function changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    await changeDashboardPassword(currentPassword, newPassword, proxyUrl);
    setStatus("unauthenticated");
    setUsername(null);
    setError(null);
  }

  function clearError(): void {
    setError(null);
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        username,
        error,
        isAuthenticated: status === "authenticated",
        authConfigured: status !== "unconfigured" && status !== "needs_proxy",
        refreshSession,
        login,
        logout,
        changePassword,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
