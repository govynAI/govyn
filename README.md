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

The wizard walks you through provider selection, API key configuration, budget limits, and agent naming. It produces a `govyn.config.yaml` in the current directory.

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

Govyn uses a `govyn.config.yaml` file. Run `npx govyn init` to generate one interactively, or create it manually:

```yaml
version: 1
proxy:
  port: 4000

providers:
  openai:
    base_url: https://api.openai.com
    api_key_env: OPENAI_API_KEY
  anthropic:
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY

budgets:
  research-agent:
    daily_limit: 10.00
    monthly_limit: 100.00
    limit_type: hard
```

See [`configs/`](./configs/) for more examples (single provider, multi-provider, team setups).

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
