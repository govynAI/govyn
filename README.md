# Govyn

Govyn is a governance proxy for AI agents. It sits between your agents and LLM providers (OpenAI, Anthropic, etc.), enforcing per-agent budgets, tracking costs, detecting loops, and logging every request -- without requiring agents to hold real API keys.

## Quickstart

Get from zero to a governed API call in under 5 minutes.

### Prerequisites

- Node.js 20+
- An LLM API key (OpenAI or Anthropic)

### Install and Configure

```bash
# Install globally (or use npx)
npm install -g govyn

# Run the interactive setup wizard
govyn init
```

The wizard walks you through provider selection, API key configuration, budget limits, and agent naming. It produces a `govyn.config.yaml` in the current directory.

### Start the Proxy

```bash
govyn
```

The proxy starts on port 4000 by default.

### Docker Alternative

```bash
docker run -p 4000:4000 -e OPENAI_API_KEY=sk-... govyn
```

Or with Docker Compose (mounts your local config):

```bash
docker-compose up
```

### Verify

```bash
curl http://localhost:4000/health
```

Expected response: `{"status":"ok"}`

### Proxy Your First Request

Send a chat completion through the proxy:

```bash
curl http://localhost:4000/v1/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Govyn-Agent: my-first-agent" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

The proxy forwards the request to OpenAI, tracks the cost, enforces budget limits, and logs the action -- all transparently.

### What's Next

- See `configs/` for example configurations (single provider, multi-provider, team setups)
- Configure per-agent budgets in `govyn.config.yaml` under the `budgets` section
- View cost summaries: `curl http://localhost:4000/api/costs`
- Check budget status: `curl http://localhost:4000/api/budgets`
- Query logs: `curl http://localhost:4000/api/logs`
