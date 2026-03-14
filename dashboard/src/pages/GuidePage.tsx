import { Link } from "react-router-dom";
import {
  BookOpen,
  HardDrive,
  LockKeyhole,
  Network,
  TerminalSquare,
} from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const localFiles = [
  "./govyn.config.yaml",
  "./govyn.auth.json",
  "./govyn.db",
  "./policies.yaml",
];

const sqliteFeatures = [
  "Approvals queue",
  "Alert rules and alert history",
  "Persistent approval records",
  "Dashboard sign-in",
  "Policy authoring",
  "Persistent cost history and daily summaries",
  "Budget enforcement from config",
];

const postgresReasons = [
  "Multiple Govyn instances need to share one durable database",
  "A team deployment needs managed backups and separate DB operations",
  "You want a remote/shared production database instead of a local file",
  "Write volume and retention are growing beyond a single-host SQLite setup",
];

export default function GuidePage() {
  return (
    <>
      <PageHeader title="Guide" />
      <div className="space-y-6 p-8">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                <BookOpen className="size-5" />
              </div>
              <div>
                <CardTitle>Self-Hosted Govyn</CardTitle>
                <p className="text-sm text-[var(--muted-foreground)]">
                  The OSS dashboard is local-auth, SQLite-backed, and safe by default.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[var(--muted-foreground)]">
            <p>
              Govyn does not ship provider keys, agent keys, or admin API keys.
              You generate and manage those yourself when your deployment needs them.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="sm">
                <Link to="/settings">Open Settings</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/policies">Manage Policies</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TerminalSquare className="size-4 text-[var(--color-accent)]" />
                Local Setup Flow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[var(--muted-foreground)]">
              <div>1. Run <code>npx govyn init</code> to generate a local config, starter policy file, and default SQLite storage.</div>
              <div>2. Run <code>npx govyn admin setup</code> if you did not create the admin during init.</div>
              <div>3. Start the proxy with <code>npx govyn</code>.</div>
              <div>4. Point this dashboard at the proxy URL in Settings and sign in with your local admin account.</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-[var(--color-accent)]" />
                Local Files
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[var(--muted-foreground)]">
              <p>These local runtime files belong to the operator and should stay out of git:</p>
              <div className="rounded-lg border bg-[var(--muted)]/40 p-4 font-mono text-xs text-[var(--foreground)]">
                {localFiles.map((entry) => (
                  <div key={entry}>{entry}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockKeyhole className="size-4 text-[var(--color-accent)]" />
                SQLite Default
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-[var(--muted-foreground)]">
              {sqliteFeatures.map((item) => (
                <div key={item}>{item}</div>
              ))}
              <p className="pt-2">
                Govyn uses <code>database.url: sqlite:./govyn.db</code> by default,
                so approvals, alerts, and operational history work on a single
                host without any separate database service.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-[var(--color-accent)]" />
                Switch to PostgreSQL When
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-[var(--muted-foreground)]">
              {postgresReasons.map((item) => (
                <div key={item}>{item}</div>
              ))}
              <p className="pt-2">
                To upgrade, change <code>database.url</code> in your local{" "}
                <code>govyn.config.yaml</code> from <code>sqlite:./govyn.db</code>{" "}
                to a <code>postgres://...</code> URL. The dashboard behavior
                stays the same; only the backing store changes.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="size-4 text-[var(--color-accent)]" />
              Remote Exposure Checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[var(--muted-foreground)]">
            <div>1. Keep <code>proxy.host: 127.0.0.1</code> unless you explicitly need remote access.</div>
            <div>2. If you bind to a non-loopback host, set at least one <code>agents.&lt;name&gt;.api_keys</code> value.</div>
            <div>3. For remote browser dashboard access, set <code>security.trusted_origins</code>.</div>
            <div>4. Use <code>GOVYN_ADMIN_API_KEY</code> for automation or recovery, not everyday dashboard sign-in.</div>
            <div>5. Keep webhook targets public and HTTPS; loopback and private-network destinations are blocked.</div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
