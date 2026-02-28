import { useState, useEffect } from "react";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { ping } from "@/lib/api-client";
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

export default function SettingsPage() {
  const { status, proxyUrl, setProxyUrl } = useProxyConnection();
  const [urlInput, setUrlInput] = useState(proxyUrl ?? "");
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
    if (!trimmed) return;
    setUrlInput(trimmed);
    setProxyUrl(trimmed);
    setTestResult(null);
  };

  const badge = statusDisplay[status];
  const hasChanges = urlInput.trim() !== (proxyUrl ?? "");

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
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
            </div>

            {/* Test result */}
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
      </div>
    </>
  );
}
