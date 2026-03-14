# Govyn

**The governance proxy for AI agents. Not an SDK. Not a wrapper. A wall.**

Every other agent governance tool is a library you import. If your agent — or any code it touches — makes a direct HTTP call, governance disappears. Govyn is different. It's an API proxy that holds your real API keys. Your agents only get a proxy URL. There is no alternative path to the real API. Governance is enforced by architecture, not by convention.

```
SDK MODEL:
Agent [has real API key] → tries wrapper → OpenAI API
Agent [has real API key] → skips wrapper → OpenAI API  ← governance bypassed

PROXY MODEL:
Agent [no real API key] → Govyn Proxy [has real key, enforces rules] → OpenAI API
Agent [no real API key] → OpenAI API directly → REJECTED (no key)
```

SDK governance is a door lock — effective until someone finds another door.
Govyn is a wall. There are no other doors.

---

## Features

- **Per-agent budgets** — Set daily/monthly spend limits per agent with hard (block) or soft (warn) enforcement
- **Cost tracking** — Real-time cost aggregation across OpenAI, Anthropic, and compatible providers
- **Loop detection** — Automatically detect and block agents stuck in repetitive call patterns
- **Policy engine** — YAML-based rules: rate limits, model restrictions, require-approval gates, and custom policies
- **Action logging** — Every request logged with agent identity, cost, tokens, latency, and full context
- **Multi-provider** — Route OpenAI and Anthropic traffic through a single proxy with per-provider API keys
- **Locked-down management API** — Local-only by default, with optional admin API key and browser origin allowlist for remote dashboards
- **Zero agent changes** — Agents just point at a different base URL. No SDK imports, no code changes
- **Fail-open by default** — Proxy errors don't break your agents. Configurable to fail-closed for high-security deployments

## Quickstart

Get from zero to a governed API call in under 5 minutes.

### Prerequisites

- Node.js 20+
- An LLM API key (OpenAI or Anthropic)

### Install and Configure

```bash
npx govyn init
```

The wizard walks you through provider selection, API key configuration, budget limits, agent naming, and persistence. It produces a local `govyn.config.yaml` in the current directory, defaults `database.url` to `sqlite:./govyn.db`, and can also point at PostgreSQL if you already run one.

### Start the Proxy

```bash
npx govyn
```

The proxy starts on port 4000 by default.

### Docker

```bash
docker run -p 4000:4000 -e OPENAI_API_KEY=sk-... govyn
```

Or with Docker Compose:

```bash
docker-compose up
```

For persistent self-hosting, mount a volume for your runtime files (`govyn.config.yaml`, `govyn.auth.json`, `govyn.db`, `policies.yaml`, and `logs/`) or point `database.url` at PostgreSQL instead of the default SQLite file.

### Verify

```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

### Make Your First Governed Request

```bash
curl http://localhost:4000/v1/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Govyn-Agent: my-first-agent" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

The proxy forwards to OpenAI, tracks cost, enforces budget limits, and logs the action — all transparently.

## Python SDK

For Python agents, use the `govynai` package for drop-in wrappers around the OpenAI and Anthropic SDKs:

```bash
pip install govynai[all]
```

```python
from govynai import GovynOpenAI

client = GovynOpenAI(agent_id="my-agent")
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}]
)
```

The wrapper automatically routes through your Govyn proxy, injects agent headers, and surfaces governance errors as typed exceptions. See [`python-sdk/`](./python-sdk/) for full documentation.

## Configuration

Govyn uses a local `govyn.config.yaml` runtime file. Run `npx govyn init` to generate one interactively in your working directory, or create one manually. The repo ships example templates under [`configs/`](./configs/); it does not ship a ready-to-use operator config.

`govyn.config.yaml` is your deployment file. Keep it local to your environment and do not treat it as a shared repo sample.

The OSS dashboard also uses a local `govyn.auth.json` file for its single admin account. Create it during `npx govyn init` or later with `npx govyn admin setup`. Keep that file local and out of git too.

Govyn now uses SQLite by default for persistence. The default runtime database is `./govyn.db`, which powers approvals, alerts, cost history, and other durable operational data on a single host. Keep that file local and out of git too.

For the smallest local-only starting point, use [`configs/openai-only.yaml`](./configs/openai-only.yaml) or generate one with `npx govyn init`. A minimal manual config looks like this:

```yaml
version: 1
proxy:
  port: 4000
  host: 127.0.0.1

providers:
  openai:
    base_url: https://api.openai.com
    api_key_env: OPENAI_API_KEY
  anthropic:
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY

agents:
  research-agent: {}

database:
  url: sqlite:./govyn.db

budgets:
  research-agent:
    daily_limit: 10.00
    monthly_limit: 100.00
    limit_type: hard
```

If you omit `database.url`, Govyn still defaults to `sqlite:./govyn.db` beside your config. Keeping it explicit in your local config makes the deployment shape clearer.

If you expose the proxy off-machine, add your own generated `agents.<name>.api_keys`. If you manage the proxy from a remote dashboard, create the local admin account on the host and add the dashboard origin under `security.trusted_origins`. Only set `security.admin_api_key_env` if you also want automation or break-glass API access.

## Dashboard Auth

- The OSS dashboard uses one local admin username/password account.
- There is no Clerk, no email-based reset flow, no signup, and no OIDC/SAML in this repo.
- Create the admin account with `npx govyn admin setup`, or let `npx govyn init` create it during first-run setup.
- Reset the password locally with `npx govyn admin reset-password`.
- Browser logins use an `HttpOnly` session cookie. `GOVYN_ADMIN_API_KEY` remains available for automation and break-glass recovery, not normal dashboard sign-in.

## Persistence

- Default OSS self-hosting: `database.url: sqlite:./govyn.db`
- SQLite is the recommended default for one host, one admin, and the normal self-hosted OSS setup.
- SQLite powers approvals, alerts, cost history, and other durable operational state without requiring a separate database service.
- Switch to PostgreSQL by setting `database.url: postgres://...` when you need a shared database, managed backups, or multiple Govyn instances against the same backend.
- The example configs under [`configs/`](./configs/) show the SQLite default and include commented PostgreSQL upgrade hints.

See [`configs/openai-only.yaml`](./configs/openai-only.yaml) for the canonical minimal example, or browse [`configs/`](./configs/) for more setups (single provider, multi-provider, teams).

## Security Defaults

- Govyn does not ship any real agent keys, admin keys, or provider secrets. Every key shown in docs or UI is a placeholder or generated locally for the operator to adopt.
- The proxy binds to `127.0.0.1` by default so a fresh install is local-only.
- If you bind the proxy to a non-loopback host such as `0.0.0.0`, Govyn automatically requires `Authorization: Bearer <agent-api-key>` on proxied model requests. Configure those keys under `agents.<name>.api_keys`.
- You can explicitly set `security.require_agent_api_key: false`, but that creates an unauthenticated spend surface and is unsafe on shared or public networks.
- `/api/*` management endpoints are restricted to local requests by default.
- Once the local dashboard admin exists, browser management uses the dashboard session cookie instead of a pasted API key.
- To manage the proxy from another browser origin, add that origin under `security.trusted_origins` and sign in with the local admin username/password.
- `GOVYN_ADMIN_API_KEY` (or another env var via `security.admin_api_key_env`) is for automation, CLI tooling, and break-glass remote API access via `X-Govyn-Admin-Key`.
- Browser dashboards must be explicitly listed under `security.trusted_origins`. Localhost origins are allowed automatically for development.
- Browser-origin management requests from untrusted origins are rejected even on localhost, which blocks CSRF-style admin actions against a developer machine.
- `GET /api/approvals/:id` remains accessible without admin auth so the approval polling flow continues to work for agents.
- Approval tokens are single-use and bound to the original approved agent, target path, and request body.
- Alert webhooks reject loopback and private-network destinations, resolve DNS before connect, and block redirects to prevent SSRF against internal services.

### Generating Agent Keys

- Generate your own long random value for every agent. Do not reuse provider API keys as agent API keys.
- The dashboard Settings page includes a browser-local generator and copy-ready YAML snippet. It helps you prepare local config only; it does not write proxy config, and the generated key is not sent to the proxy unless you manually add it to your config.
- If you prefer the terminal, `node -e "console.log('gvn_' + require('node:crypto').randomBytes(32).toString('hex'))"` prints a suitable key.

## Policy Engine

Define governance rules in `policies.yaml`:

```yaml
policies:
  - name: require-approval-for-gpt4
    match:
      model: "gpt-4*"
    action: require_approval
    message: "GPT-4 usage requires human approval"

  - name: block-production-models-at-night
    match:
      model: "gpt-4o"
    schedule:
      deny: "0 22 * * *-0 6 * * *"
    action: block
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/costs` | Cost summaries per agent |
| `GET /api/budgets` | Budget status and remaining limits |
| `GET /api/logs` | Query action logs |
| `GET /api/policies` | List active policies |
| `POST /v1/openai/...` | Proxied OpenAI requests |
| `POST /v1/anthropic/...` | Proxied Anthropic requests |

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────┐     ┌─────────────┐
│   Agent A    │────▶│          Govyn Proxy             │────▶│   OpenAI    │
│  (no key)    │     │                                  │     │   API       │
└─────────────┘     │  ┌──────────┐  ┌──────────────┐  │     └─────────────┘
                    │  │ Policy   │  │ Budget       │  │
┌─────────────┐     │  │ Engine   │  │ Enforcer     │  │     ┌─────────────┐
│   Agent B    │────▶│  └──────────┘  └──────────────┘  │────▶│  Anthropic  │
│  (no key)    │     │  ┌──────────┐  ┌──────────────┐  │     │   API       │
└─────────────┘     │  │ Loop     │  │ Action       │  │     └─────────────┘
                    │  │ Detector │  │ Logger       │  │
┌─────────────┐     │  └──────────┘  └──────────────┘  │
│   Agent C    │────▶│                                  │
│  (no key)    │     │  Real API keys live here only    │
└─────────────┘     └──────────────────────────────────┘
```

Agents never hold real API keys. The proxy is the only path to the real APIs.

## Project Structure

```
govyn/
├── src/              # Proxy server (TypeScript)
├── python-sdk/       # Python SDK (govynai package)
├── configs/          # Example configurations
├── templates/        # Init wizard templates
├── tests/            # Proxy test suite
└── docs/             # Documentation
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on submitting pull requests, reporting issues, and development setup.

## License

[MIT](./LICENSE) — Copyright (c) 2026 GovynAI
