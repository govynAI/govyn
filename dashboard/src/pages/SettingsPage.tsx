import { useState, useEffect } from "react";
import { Loader2, CheckCircle, XCircle, Copy, RefreshCw, KeyRound, HardDrive } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/layout/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { normalizeProxyUrl, ping } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ConnectionStatus } from "@/contexts/ProxyConnectionContext";

const statusDisplay: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  connected: {
    label: "Connected",
    className: "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#22c55e]",
  },
  disconnected: {
    label: "Disconnected",
    className: "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]",
  },
  reconnecting: {
    label: "Reconnecting",
    className: "border-[#eab308]/30 bg-[#eab308]/10 text-[#eab308]",
  },
};

type TestResult = { ok: true; latencyMs: number } | { ok: false; error: string } | null;

function createAgentApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `gvn_${token}`;
}

export default function SettingsPage() {
  const { changePassword } = useAuth();
  const { status, proxyUrl, setProxyUrl } = useProxyConnection();
  const [urlInput, setUrlInput] = useState(proxyUrl ?? "");
  const [agentNameInput, setAgentNameInput] = useState("remote-agent");
  const [generatedAgentKey, setGeneratedAgentKey] = useState(() =>
    createAgentApiKey()
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  // Keep input in sync if proxy URL changes externally
  useEffect(() => {
    setUrlInput(proxyUrl ?? "");
  }, [proxyUrl]);

  const handleTest = async () => {
    if (!urlInput.trim()) return;
    setTesting(true);
    setTestResult(null);

    const result = await ping(urlInput.trim());
    if (result.ok) {
      setTestResult({ ok: true, latencyMs: result.latencyMs });
    } else {
      setTestResult({ ok: false, error: "Could not reach proxy at this URL" });
    }
    setTesting(false);
  };

  const handleSave = () => {
    const trimmed = urlInput.trim().replace(/\/+$/, "");
    if (trimmed) {
      const normalized = normalizeProxyUrl(trimmed);
      setUrlInput(normalized);
      setProxyUrl(normalized);
    }
    setTestResult(null);
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated. Sign in again with the new password.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update password";
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  };

  const badge = statusDisplay[status];
  const hasChanges = urlInput.trim() !== (proxyUrl ?? "");
  const normalizedAgentName =
    agentNameInput.trim().replace(/[^a-zA-Z0-9_-]+/g, "-") || "remote-agent";
  const agentConfigSnippet = `agents:
  ${normalizedAgentName}:
    api_keys:
      - ${generatedAgentKey}`;
  const sqliteSnippet = `database:
  url: sqlite:./govyn.db`;
  const postgresSnippet = `database:
  url: postgres://govyn:change-me@db.example.com:5432/govyn`;
  const agentRequestSnippet = `curl ${urlInput.trim() || "http://localhost:4000"}/v1/openai/v1/chat/completions \\
  -H "Authorization: Bearer ${generatedAgentKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`;

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-3xl space-y-6 p-8">
        {/* Proxy Connection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle>Proxy Connection</CardTitle>
                <CardDescription>
                  Configure the URL of your Govyn proxy server
                </CardDescription>
              </div>
              <Badge variant="outline" className={badge.className}>
                {badge.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="proxy-url">Proxy URL</Label>
              <Input
                id="proxy-url"
                type="text"
                placeholder="http://localhost:4000"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setTestResult(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTest();
                }}
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                The full URL of your running Govyn proxy, including port
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Local browser sessions work best when this uses the same
                loopback hostname as the dashboard page.
              </p>
            </div>

            {testResult && (
              <div
                className={
                  testResult.ok
                    ? "flex items-center gap-2 text-sm text-[#22c55e]"
                    : "flex items-center gap-2 text-sm text-[#ef4444]"
                }
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle className="size-4" />
                    <span>
                      Connection successful ({testResult.latencyMs}ms)
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4" />
                    <span>{testResult.error}</span>
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || !urlInput.trim()}
              >
                {testing && <Loader2 className="size-3.5 animate-spin" />}
                Test Connection
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!urlInput.trim() || !hasChanges}
              >
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-[#14b8a6]/10 text-[#14b8a6]">
                <HardDrive className="size-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>Persistence</CardTitle>
                <CardDescription>
                  Govyn uses SQLite by default for approvals, alerts, and
                  history. Switch <code>database.url</code> to PostgreSQL only
                  when you need a shared or multi-instance deployment.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="sqlite-config-snippet">SQLite Default</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyText("SQLite snippet", sqliteSnippet)}
                  >
                    <Copy className="size-4" />
                    Copy
                  </Button>
                </div>
                <textarea
                  id="sqlite-config-snippet"
                  readOnly
                  value={sqliteSnippet}
                  className="min-h-24 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs leading-5 outline-none"
                />
                <p className="text-xs text-[var(--muted-foreground)]">
                  Best for a single host. Govyn creates <code>./govyn.db</code>{" "}
                  automatically beside your local config if it does not exist yet.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="postgres-config-snippet">PostgreSQL Upgrade</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyText("PostgreSQL snippet", postgresSnippet)}
                  >
                    <Copy className="size-4" />
                    Copy
                  </Button>
                </div>
                <textarea
                  id="postgres-config-snippet"
                  readOnly
                  value={postgresSnippet}
                  className="min-h-24 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs leading-5 outline-none"
                />
                <p className="text-xs text-[var(--muted-foreground)]">
                  Best for shared or multi-instance deployments. Switching the
                  URL changes the backend without changing the dashboard auth model.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>Password</CardTitle>
              <CardDescription>
                Change the local OSS dashboard password for this self-hosted
                admin account.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Password resets for the OSS build are local-only. If you lose
              access, run <code>govyn admin reset-password</code> on the host.
            </p>
            <Button
              type="button"
              onClick={() => void handlePasswordChange()}
              disabled={
                changingPassword ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
            >
              {changingPassword && <Loader2 className="size-4 animate-spin" />}
              Update Password
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-[#2563eb]/10 text-[#2563eb]">
                <KeyRound className="size-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>Agent Access Setup</CardTitle>
                <CardDescription>
                  Generate your own agent API key locally, then copy the snippet
                  into your own <code>govyn.config.yaml</code>. This page helps
                  you prepare config only; it does not write proxy config or
                  ship a real secret.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-[#2563eb]/20 bg-[#2563eb]/5 p-3 text-sm text-[var(--foreground)]">
              This generator runs entirely in your browser. The key is never
              sent to the proxy by this page and disappears on refresh unless
              you copy it into your own local config.
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Agent Name</Label>
                <Input
                  id="agent-name"
                  type="text"
                  value={agentNameInput}
                  onChange={(e) => setAgentNameInput(e.target.value)}
                  placeholder="remote-agent"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full md:w-auto"
                  onClick={() => setGeneratedAgentKey(createAgentApiKey())}
                >
                  <RefreshCw className="size-4" />
                  Generate New Key
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-key">Generated Agent API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="agent-key"
                  type="text"
                  readOnly
                  value={generatedAgentKey}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyText("Agent API key", generatedAgentKey)}
                >
                  <Copy className="size-4" />
                  Copy
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="agent-config-snippet">Config Snippet</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText("Config snippet", agentConfigSnippet)}
                >
                  <Copy className="size-4" />
                  Copy YAML
                </Button>
              </div>
              <textarea
                id="agent-config-snippet"
                readOnly
                value={agentConfigSnippet}
                className="min-h-28 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs leading-5 outline-none"
              />
              <p className="text-xs text-[var(--muted-foreground)]">
                Add this under <code>agents</code>. If you expose the proxy on{" "}
                <code>0.0.0.0</code> or another non-loopback host, Govyn now
                requires one of these keys by default.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="agent-request-snippet">Request Example</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText("Request example", agentRequestSnippet)}
                >
                  <Copy className="size-4" />
                  Copy cURL
                </Button>
              </div>
              <textarea
                id="agent-request-snippet"
                readOnly
                value={agentRequestSnippet}
                className="min-h-36 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs leading-5 outline-none"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
