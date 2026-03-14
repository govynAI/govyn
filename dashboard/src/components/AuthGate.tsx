import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Shield, Server, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { useTheme } from "@/hooks/useTheme";
import { normalizeProxyUrl } from "@/lib/api-client";
import BrandLogo from "@/components/branding/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const { status, error, login, clearError } = useAuth();
  const { proxyUrl, setProxyUrl, status: connectionStatus } = useProxyConnection();
  const { isDark } = useTheme();
  const [urlInput, setUrlInput] = useState(proxyUrl ?? "");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setUrlInput(proxyUrl ?? "");
  }, [proxyUrl]);

  const normalizedProxyUrl = normalizeProxyUrl(urlInput);

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearError();

    if (!normalizedProxyUrl) {
      return;
    }

    setSubmitting(true);
    setProxyUrl(normalizedProxyUrl);
    await login(username, password, normalizedProxyUrl);
    setSubmitting(false);
    setPassword("");
  }

  const needsProxy = status === "needs_proxy";
  const unconfigured = status === "unconfigured";
  const loading = status === "loading";

  if (status === "authenticated") {
    return children;
  }

  return (
    <div
      className={`flex min-h-screen items-center justify-center px-6 py-10 ${
        isDark
          ? "bg-[radial-gradient(circle_at_top,#10332f,transparent_40%),linear-gradient(180deg,#0a0a0a,#09090b)]"
          : "bg-[radial-gradient(circle_at_top,#c7f9f0,transparent_42%),linear-gradient(180deg,#ffffff,#f4f4f5)]"
      }`}
    >
      <Card
        className={`w-full max-w-md backdrop-blur ${
          isDark
            ? "border-white/10 bg-black/70"
            : "border-black/10 bg-white/90 shadow-xl shadow-black/5"
        }`}
      >
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <BrandLogo className="h-11" />
            <div className="flex size-12 items-center justify-center rounded-full bg-[#14b8a6]/15 text-[#14b8a6]">
              {unconfigured ? (
                <AlertTriangle className="size-6" />
              ) : (
                <Shield className="size-6" />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle>Govyn Dashboard</CardTitle>
            <CardDescription>
              Self-hosted OSS access uses a local admin username and password.
              No Clerk, no SaaS auth dependency.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="proxy-url">Proxy URL</Label>
            <div className="flex gap-2">
              <Input
                id="proxy-url"
                type="text"
                placeholder="http://localhost:4000"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!normalizedProxyUrl}
                onClick={() => setProxyUrl(normalizedProxyUrl)}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Stored locally in this browser. Current connection status:{" "}
              <span className="font-medium capitalize">{connectionStatus}</span>.
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              For local self-hosting, keep the dashboard and proxy on the same
              loopback hostname. If this page is opened on <code>127.0.0.1</code>,
              the proxy URL will be normalized away from <code>localhost</code> automatically.
            </p>
          </div>

          {needsProxy && (
            <div className="rounded-lg border border-[#14b8a6]/20 bg-[#14b8a6]/8 p-3 text-sm text-[var(--foreground)]">
              Set the URL of your running Govyn proxy to check dashboard auth.
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="size-4 animate-spin" />
              Checking dashboard session…
            </div>
          )}

          {unconfigured && (
            <div className="space-y-3 rounded-lg border border-[#eab308]/20 bg-[#eab308]/8 p-4 text-sm text-[var(--foreground)]">
              <div className="flex items-center gap-2 font-medium text-[#facc15]">
                <Server className="size-4" />
                Local admin account not configured
              </div>
              <p>
                Run <code>govyn admin setup</code> on the host machine to create
                the single OSS dashboard admin account.
              </p>
              <p className="text-[var(--muted-foreground)]">
                After setup completes, reload this page and sign in with the new
                username and password.
              </p>
            </div>
          )}

          {!needsProxy && !unconfigured && !loading && (
            <form className="space-y-4" onSubmit={(event) => void handleLogin(event)}>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {error && (
                <div className="rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/8 p-3 text-sm text-[#fca5a5]">
                  {error}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !normalizedProxyUrl || !username.trim() || !password}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Sign In
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
