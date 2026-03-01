# Govyn SDK Specification

| Field   | Value                                                              |
|---------|--------------------------------------------------------------------|
| Version | 1.0                                                                |
| Date    | 2026-03-01                                                         |
| Status  | Canonical -- both SDKs MUST implement this spec identically        |

This document is the single source of truth for the Python SDK (Phase 17, `govynai` package) and the Node.js SDK (Phase 18, `govyn` package). Every constant, convention, error code, URL formula, API key mode, and behavioral requirement is defined here so that both SDKs implement identical behavior without cross-referencing each other's code.

---

## 1. Constants

All canonical constant values in one reference table. SDKs MUST use these exact strings.

| Constant                  | Value                      | Notes                                                |
|---------------------------|----------------------------|------------------------------------------------------|
| Agent header name         | `X-Govyn-Agent`            | Case-insensitive; Node.js HTTP parser lowercases to `x-govyn-agent` |
| Proxy URL env var         | `GOVYN_PROXY_URL`          | SDK-side only; proxy does not read this               |
| Agent ID env var          | `GOVYN_AGENT_ID`           | SDK-side only; proxy does not read this               |
| Default proxy URL         | `http://localhost:4000`    | Matches proxy default `port: 4000`                    |
| OpenAI route prefix       | `/v1/openai`               | Proxy strips this prefix before forwarding            |
| Anthropic route prefix    | `/v1/anthropic`            | Proxy strips this prefix before forwarding            |
| Health endpoint           | `GET /health`              | Returns JSON with `status`, `version`, `uptime_seconds` |
| Budget warning header     | `X-Govyn-Budget-Warning`   | JSON payload; future SDK surfacing (not v1.3)         |
| Approval header           | `X-Govyn-Approval`         | Used by approval queue flow                           |
| Passthrough API key       | `govyn-passthrough`        | Placeholder; proxy replaces with real key             |
| Scoped key prefix         | `gvn_`                     | e.g., `gvn_ra_xxxx` per agent                        |

---

## 2. URL Construction

SDKs construct a `base_url` that points at the proxy's provider-specific route. The proxy strips the route prefix and forwards the remainder to the upstream API.

### OpenAI

```
base_url = {GOVYN_PROXY_URL}/v1/openai
```

The upstream OpenAI SDK appends paths like `/chat/completions`, producing:

```
{GOVYN_PROXY_URL}/v1/openai/v1/chat/completions
```

The proxy strips `/v1/openai` and forwards `/v1/chat/completions` to `https://api.openai.com`.

### Anthropic

```
base_url = {GOVYN_PROXY_URL}/v1/anthropic
```

The upstream Anthropic SDK appends paths like `/v1/messages`, producing:

```
{GOVYN_PROXY_URL}/v1/anthropic/v1/messages
```

The proxy strips `/v1/anthropic` and forwards `/v1/messages` to `https://api.anthropic.com`.

### CRITICAL: Per-SDK Path Verification

The exact `base_url` value depends on how each upstream SDK appends paths internally. For example, the Python OpenAI SDK strips a trailing `/v1` from `base_url` before appending `/chat/completions`. Each SDK phase (Phase 17, Phase 18) MUST empirically verify the exact `base_url` string by inspecting the actual HTTP request URL produced.

### Double-Slash Warning

Ensure no `//` appears in constructed URLs. A trailing slash on `proxy_url` combined with a leading slash on the route prefix produces `http://localhost:4000//v1/openai`. SDKs SHOULD strip trailing slashes from `proxy_url` before concatenation.

---

## 3. Header Injection

SDKs MUST set the agent identification header as a default header on every request:

```
X-Govyn-Agent: {agent_id}
```

**Rules:**

- The header is case-insensitive. Node.js HTTP parser lowercases it to `x-govyn-agent`.
- When `X-Govyn-Agent` is present, it takes priority over API-key-based agent identification.
- The header MUST be set via the upstream SDK's `default_headers` constructor parameter so it is included on every request automatically, including streaming requests.

---

## 4. API Key Convention

Two modes for API key handling. Both are supported simultaneously by the proxy.

### Passthrough Mode (Recommended Default)

The SDK sends a placeholder API key. The proxy strips the placeholder and injects the real upstream API key from its own environment variables.

| Provider   | Header                          | Value               |
|------------|---------------------------------|----------------------|
| OpenAI     | `Authorization: Bearer ...`     | `govyn-passthrough`  |
| Anthropic  | `x-api-key: ...`                | `govyn-passthrough`  |

**Use when:** The proxy holds all real API keys. This is the recommended setup for most deployments.

The upstream SDK constructors accept an `api_key` parameter. Setting `api_key="govyn-passthrough"` causes the SDK to send the placeholder in the appropriate header format for each provider.

### Key-Storage Mode (Scoped Keys)

The operator generates scoped keys with the `gvn_` prefix (e.g., `gvn_ra_xxxx`) per agent. The SDK sends the scoped key in the auth header.

| Provider   | Header                          | Value               |
|------------|---------------------------------|----------------------|
| OpenAI     | `Authorization: Bearer ...`     | `gvn_ra_xxxx`       |
| Anthropic  | `x-api-key: ...`                | `gvn_ra_xxxx`       |

The proxy uses the scoped key to identify the agent (via API key lookup) AND injects the real upstream API key before forwarding.

**Use when:** Agent identity must be cryptographically tied to specific keys, not self-reported headers.

**Priority note:** When both `X-Govyn-Agent` header and a scoped API key are present, the header takes priority for agent identification.

---

## 5. Constructor Requirements

All SDK wrapper constructors MUST implement the following parameter resolution and defaults.

### Parameters

| Parameter         | Resolution Order                                                    | Default             |
|-------------------|---------------------------------------------------------------------|---------------------|
| `agent_id`        | Constructor arg > `GOVYN_AGENT_ID` env var > **raise error**        | None (mandatory)    |
| `proxy_url`       | Constructor arg > `GOVYN_PROXY_URL` env var > `http://localhost:4000`| `http://localhost:4000` |
| `api_key`         | Constructor arg > `"govyn-passthrough"`                             | `"govyn-passthrough"` |
| `max_retries`     | Always `0` (not configurable)                                       | `0`                 |
| `base_url`        | Computed: `{proxy_url}/{provider_route_prefix}`                     | Derived             |
| `default_headers` | Always includes `{"X-Govyn-Agent": agent_id}`                      | Derived             |

### Locked Decisions

**`agent_id` is MANDATORY.** If neither the constructor argument nor the `GOVYN_AGENT_ID` environment variable provides a value, the SDK MUST raise an explicit error. It MUST NOT silently default to `"unknown"` or any other fallback. This ensures every request is attributed to a named agent.

**`max_retries` MUST be `0`.** The proxy counts each incoming request independently. If the upstream SDK retries a request, the proxy counts the retry as a separate billable request. This causes double-billing and triggers false positives in loop detection. Both OpenAI and Anthropic SDKs default to `max_retries=2`; the wrapper MUST override this to `0`.

**`base_url` is derived, not user-configurable.** It is computed from `proxy_url` + the provider route prefix. Users configure `proxy_url`; the SDK computes `base_url`.

### Constructor Pseudocode

```
class GovynOpenAI(OpenAI):
  def __init__(self, agent_id=None, proxy_url=None, api_key=None, **kwargs):
    # 1. Resolve agent_id (mandatory)
    agent_id = agent_id or env("GOVYN_AGENT_ID")
    if not agent_id:
      raise ValueError("agent_id is required: pass it to the constructor or set GOVYN_AGENT_ID")

    # 2. Resolve proxy URL
    proxy_url = proxy_url or env("GOVYN_PROXY_URL") or "http://localhost:4000"

    # 3. Build base_url (provider-specific)
    base_url = f"{proxy_url.rstrip('/')}/v1/openai"

    # 4. API key placeholder
    api_key = api_key or "govyn-passthrough"

    # 5. Inject agent header
    default_headers = {"X-Govyn-Agent": agent_id}

    # 6. Force no retries
    super().__init__(
      base_url=base_url,
      api_key=api_key,
      max_retries=0,
      default_headers=default_headers,
      **kwargs
    )
```

The same pattern applies to `GovynAnthropic`, `GovynAsyncOpenAI`, and `GovynAsyncAnthropic`, changing only the route prefix (`/v1/anthropic` for Anthropic wrappers).
