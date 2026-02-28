# Pitfalls Research

**Domain:** Drop-in replacement SDKs for openai/anthropic clients routing through Govyn proxy
**Researched:** 2026-02-28
**Confidence:** HIGH (verified against official SDK source, GitHub issues, and community reports)

---

## Critical Pitfalls

### Pitfall 1: base_url Path Construction — Double Slashes and Route Mismatches

**What goes wrong:**
The Govyn proxy exposes routes at `/v1/openai/*` and `/v1/anthropic/*`. The OpenAI SDK appends `/v1/chat/completions` to whatever base_url you give it. If the SDK user passes `http://localhost:4000/v1/openai/v1` (guessing at the path), the proxy receives `/v1/openai/v1/chat/completions` which matches but double-prefixes the upstream path. If they pass `http://localhost:4000` (forgetting the provider prefix), the proxy receives `/v1/chat/completions` which returns a 404. Both failure modes are silent — the user sees confusing 404s or upstream errors, not a clear message about base_url format.

**Why it happens:**
The OpenAI Python SDK enforces a trailing slash on `base_url` and then appends the API path. The Anthropic Python SDK does the same. URL construction is not documented as a first-class concern for proxy users. The "obvious" base_url to a user is `http://localhost:4000` (the server root), but that omits the required provider prefix that Govyn's router needs.

Documented real-world case: `/v1/chat/completions/chat/completions/` double-path bug from users who included endpoint paths in base_url (OpenAI Community issue #680371). The OpenAI SDK has `_enforce_trailing_slash()` logic that mangles user-supplied paths in non-obvious ways.

**How to avoid:**
The SDK must document — and ideally enforce — the exact base_url format. The correct value is `http://localhost:4000/v1/openai` (for OpenAI) or `http://localhost:4000/v1/anthropic` (for Anthropic). The SDK factory functions should set this automatically so users never have to think about it:
```python
# govynai
client = govynai.openai(proxy_url="http://localhost:4000", agent="my-agent")
# internally sets: base_url = "http://localhost:4000/v1/openai"
```

**Warning signs:**
- 404 errors from the proxy on every request
- Error messages mentioning route paths with double slashes
- Users reporting it "works without proxy" but not with

**Phase to address:**
Python SDK Phase (factory functions must set base_url correctly; test end-to-end URL construction with an actual proxy instance).

---

### Pitfall 2: SDK Retry Logic Causes Double Billing and Budget Miscounting

**What goes wrong:**
The OpenAI Python SDK defaults to `max_retries=2`; the Anthropic SDK defaults to `max_retries=2` as well. When a request reaches the proxy and is allowed, the proxy forwards it and the provider charges tokens. If the provider responds slowly and the SDK-side timeout fires, the SDK retries the request. The proxy sees this as a new request, records a second cost entry, and the provider may also process it as a second call. The budget enforcer counts the first request against the agent's budget. The second request may cause a budget breach that would not have occurred without retries.

For Govyn specifically, loop detection uses request hashing. If the SDK retries an identical request within the cooldown window, the proxy may trigger loop detection on a legitimate retry, blocking the agent.

**Why it happens:**
SDK-level retries are transparent to the proxy — the proxy cannot distinguish a first attempt from a retry. Both attempts increment budget counters. The OpenAI SDK retries on connection errors, 429s, and 5xx errors by default. Govyn forwards 429s verbatim (per ADR-016), which means SDK retries on 429 are double-counted.

**How to avoid:**
The govynai/govyn SDK wrappers should set `max_retries=0` by default, delegating retry responsibility to the proxy or the user's own retry logic. Document this explicitly. Alternatively, advise users to configure the underlying client with `max_retries=0` when using a proxy that has its own budget tracking.

```python
# govynai sets this internally
client = openai.OpenAI(
    base_url=...,
    max_retries=0,  # proxy handles retry policy
    api_key="govyn-key",
)
```

**Warning signs:**
- Budget usage is consistently higher than expected
- Loop detection triggers on agents that aren't actually looping
- Cost records show duplicates for the same request within seconds

**Phase to address:**
Python SDK Phase and Node.js SDK Phase (both must disable SDK retries by default with documentation explaining why).

---

### Pitfall 3: SSE Streaming Connection Not Returned to Pool After Stream Ends

**What goes wrong:**
In the OpenAI Python SDK, when a streaming response is consumed, the underlying httpx connection is not automatically returned to the pool unless the response is explicitly closed. With `max_connections=N`, after N streaming requests the pool is exhausted and subsequent requests hang until timeout. This is a documented bug fixed in openai-python 1.2.3, but any code that wraps the streaming flow in a way that bypasses the SDK's context manager risks reintroducing the issue.

For the govynai SDK, if the wrapper's `stream()` helper does not use `async with` (or calls `.aclose()` after iteration), long-running agents with many streaming calls will see connection hangs that appear as latency spikes.

**Why it happens:**
httpx requires explicit connection release after streaming responses when not using context managers. The OpenAI SDK fixed this internally but the fix depends on the response being closed via `stream.response.aclose()` or `async with client.stream(...)`. Wrappers that expose raw stream iterators without enforcing cleanup inherit this problem.

**How to avoid:**
The govynai streaming helpers must use context managers internally:
```python
async with client.messages.stream(...) as stream:
    async for text in stream.text_stream:
        yield text
# connection released here
```
Never expose raw stream objects without documenting the close requirement. Add a test: open 10 streaming requests sequentially and verify the 11th succeeds without timeout.

**Warning signs:**
- Latency increases after many streaming requests in the same process
- `httpx.PoolTimeout` errors appearing after extended use
- Hanging requests with no error, especially in async code

**Phase to address:**
Python SDK Phase (streaming path is first-class; the streaming helper function must be tested for pool exhaustion with many sequential calls).

---

### Pitfall 4: The `proxies` kwarg Was Removed from OpenAI SDK — Breaking Old Integration Patterns

**What goes wrong:**
OpenAI Python SDK v1.56.0 removed the `proxies` constructor argument (previously used for HTTP proxy configuration) to align with httpx 0.28.0 which also removed the `proxies` parameter. Any documentation or example code using `proxies=` breaks silently or raises `TypeError: Client.__init__() got an unexpected keyword argument 'proxies'`. The govynai SDK should not rely on or suggest the `proxies=` pattern.

**Why it happens:**
The SDK uses httpx under the hood. When httpx 0.28.0 dropped `proxies` as a deprecated argument (November 2024), the OpenAI SDK had to follow. Old blog posts, Stack Overflow answers, and unofficial tutorials still show `proxies=`.

**How to avoid:**
govynai must configure the underlying client using `base_url` only, not `proxies`. The govyn Node.js SDK must use the `httpAgent`/`fetchOptions` pattern for any proxy network configuration, not deprecated proxy options. Do not reference `proxies=` in any documentation or examples.

**Warning signs:**
- `TypeError: Client.__init__() got an unexpected keyword argument 'proxies'`
- Examples copied from older integration guides fail immediately

**Phase to address:**
Python SDK Phase (verify against current openai-python ≥1.56 and anthropic-sdk-python; test with pinned versions in CI).

---

### Pitfall 5: Agent Header Not Forwarded — Governance Silently Disabled

**What goes wrong:**
The proxy identifies agents via the `X-Govyn-Agent` header. If the govynai/govyn SDK does not inject this header on every request, the agent is identified as `unknown` and all policy enforcement, budget tracking, and cost attribution runs against the anonymous bucket. No error is raised — the proxy silently accepts requests and applies default-agent rules. Users will not notice until they look at the dashboard and see all costs attributed to "unknown" instead of their named agents.

**Why it happens:**
Both the OpenAI and Anthropic SDKs support `default_headers` in the constructor, which are merged into every request. If the SDK wrapper does not call the underlying client with `default_headers={"X-Govyn-Agent": agent_id}`, the header is never sent. The proxy header mapping code in `providers/openai.ts` and `providers/anthropic.ts` explicitly only forwards a specific allowlist of headers — `x-govyn-agent` is in that allowlist, but it has to arrive in the first place.

**How to avoid:**
The SDK factory must pass `default_headers` to the underlying client:
```python
# govynai internal implementation
client = openai.OpenAI(
    base_url=proxy_url + "/v1/openai",
    api_key=govyn_api_key,
    default_headers={"X-Govyn-Agent": agent_id},
    max_retries=0,
)
```
Add a test that verifies the `X-Govyn-Agent` header appears in every request, including streaming requests.

**Warning signs:**
- Dashboard shows costs attributed to "unknown" agent
- Budget limits for specific agents are never triggered
- Policy rules scoped to agent IDs never fire

**Phase to address:**
Python SDK Phase and Node.js SDK Phase (both must inject the agent header; this is the #1 thing that makes the SDK valuable and must be verified with integration tests against a real proxy instance).

---

### Pitfall 6: ESM/CJS Dual-Format Problem for the govyn Node.js SDK

**What goes wrong:**
The existing govyn package uses `"type": "module"` in package.json (pure ESM). If the govyn SDK module is consumed by a CJS project (any older Next.js version, Jest without ESM config, or any CommonJS script), it will fail at import time with `ERR_REQUIRE_ESM`. Conversely, if the SDK ships as CJS only, modern ESM projects face friction. The OpenAI Node.js SDK solves this with a dual-format build that ships both `dist/cjs/` and `dist/esm/` with conditional exports — but this adds significant build complexity.

**Why it happens:**
TypeScript in 2025 with ESM and CJS dual publishing is still described as "a mess" (Liran Tal, 2025). The standard approach (tsup or tsdown dual compilation) generates `.js` and `.cjs` outputs with matching `.d.ts` and `.d.cts` type declarations. Missing the `.d.cts` files causes type checking failures in CJS consumers even when runtime works. The dual-package hazard means two copies of the SDK can end up in the same runtime if poorly configured.

**How to avoid:**
Use `tsup` to build dual-format output. Keep the govyn SDK as a separate sub-package (e.g., `govyn/sdk` or a separate `govyn-sdk` package) to avoid contaminating the server's `"type": "module"` setting. Verify with both `require()` (CJS) and `import` (ESM) in integration tests. Ship `.d.cts` files.

**Warning signs:**
- `ERR_REQUIRE_ESM` in user projects
- Types work in IDE but TypeScript compilation fails with CJS consumers
- `require('govyn')` returns undefined or throws

**Phase to address:**
Node.js SDK Phase (build configuration is a prerequisite to any functionality; validate dual-format output before writing SDK logic).

---

### Pitfall 7: Anthropic SDK `anthropic-version` Header Silently Defaults

**What goes wrong:**
The proxy's `mapAnthropicHeaders()` function sets `anthropic-version: 2023-06-01` if the header is not provided. The Anthropic SDK also sets this header. If a user upgrades the Anthropic SDK to a version that sends a newer `anthropic-version` value, the proxy must forward that value through, not override it. Currently the proxy forwards the version if present (correct), but the govynai SDK must not accidentally strip or re-set this header.

More critically: if govynai wraps the Anthropic SDK and passes custom `default_headers`, those headers are merged with SDK-set headers. If the merge order is wrong and govynai sets `anthropic-version` explicitly, it would pin users to an old API version regardless of the underlying Anthropic SDK version they use.

**Why it happens:**
The Anthropic SDK's header merge order is: standard headers → platform headers → auth headers → custom headers. Custom headers supplied via `default_headers` override defaults. Govynai must only inject `X-Govyn-Agent` in `default_headers`, not API version headers, to avoid version pinning.

**How to avoid:**
govynai must only inject the minimum required headers (`X-Govyn-Agent`, API key). Never set `anthropic-version`, `anthropic-beta`, or content-type via `default_headers` — let the Anthropic SDK manage those. Verify that the version header seen by the proxy matches what the Anthropic SDK would send natively.

**Warning signs:**
- Users on new Anthropic SDK versions experience unexpected API behavior
- Features available in newer `anthropic-version` values don't work through govynai

**Phase to address:**
Python SDK Phase (Anthropic SDK wrapper specifically; test with multiple SDK versions to verify header passthrough).

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Ship govynai as a thin wrapper with no streaming helper | Less code to write | Users must manage stream cleanup themselves; connection leaks in production | Never — streaming is first-class |
| Document `proxies=` as the proxy configuration method | Familiar to users | Breaks on openai-python ≥1.56.0 (httpx 0.28+ removed it) | Never |
| Use a single ESM-only Node.js SDK package | Simpler build | Breaks CJS consumers (many enterprise Node.js codebases) | Only if explicitly targeting ESM-only projects |
| Keep max_retries at SDK default (2) | SDK retry behavior "just works" | Double billing, budget miscounting, spurious loop detection | Never for proxy-routed clients |
| Inject agent ID from environment variable only | No code change for users | If the env var is not set, silent fallback to "unknown" agent | Acceptable as a fallback; must be documented |
| Use `openai.OpenAI` subclass with overridden methods | Deeper interception | Private API surface is unstable; breaks on SDK minor versions | Never — use base_url + default_headers pattern |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenAI Python SDK | Setting `base_url="http://localhost:4000"` (missing `/v1/openai`) | Set `base_url="http://localhost:4000/v1/openai"` — the SDK appends `/chat/completions` from there |
| Anthropic Python SDK | Setting `base_url="http://localhost:4000/v1/anthropic/"` (trailing slash causes double-slash in path) | Set `base_url="http://localhost:4000/v1/anthropic"` without trailing slash; the SDK enforces its own trailing slash handling |
| OpenAI Node.js SDK | Using `httpAgent` with a raw proxy address instead of base_url for routing | Govyn routing is done via URL path, not HTTP CONNECT proxy; use `baseURL` pointing to the proxy, not `httpAgent` |
| Both SDKs | Not disabling SDK retries (`max_retries > 0`) | Set `max_retries=0`; document that the proxy handles governance, not SDK-level retry policies |
| Both SDKs | Passing the user's real OpenAI/Anthropic API key as the `api_key` parameter | The API key should be a govyn API key (or any non-empty string); the proxy injects the real key from its environment |
| govynai packaging | Publishing without `py.typed` marker and type stubs | Include `py.typed` in the package and ship `.pyi` stub files so mypy and pyright work for govynai users |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Connection pool exhaustion from unclosed streams | Latency spikes after many sequential streaming calls; `httpx.PoolTimeout` | Always use context managers or call `.aclose()` after streaming; test with 20+ sequential streams | After ~10-20 streaming requests in the same process |
| Creating a new SDK client on every request | Works fine for low volume; obvious fix for "shared state" concerns | Create one client per agent configuration and reuse it; httpx connection pool is the performance benefit | High-request-rate agents (100+ req/min) will see connection overhead |
| Injecting agent ID via a mutable shared variable | Works in single-threaded tests | Use per-client instances, not shared state; `default_headers` on the client instance is safe | Concurrent requests from multiple agents sharing one client instance |
| Python synchronous client in async code | Works until concurrency is needed | Use `AsyncOpenAI` / `AsyncAnthropic` in async contexts; `OpenAI` / `Anthropic` in sync contexts | Any async event loop with concurrent agent tasks |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Accepting the real API key as `api_key` parameter and forwarding it to the proxy | The real provider key transits the network if proxy is remote; user assumes govyn holds it | govynai SDK documentation must make clear that the `api_key` parameter is a govyn governance key, not the provider key; the proxy injects the real key from its secure environment |
| Logging the govyn API key in SDK debug output | Key exposure in logs | Ensure the SDK never logs `api_key`, `default_headers` values containing keys, or Authorization headers |
| Trusting `X-Govyn-Agent` header supplied by the caller without verification | An agent could claim to be a different agent and use its budget | This is a proxy-side concern (already handled via scoped API keys), but SDK documentation must not imply header-only auth is sufficient for security — it is for routing/attribution only |
| Not validating that proxy_url is https in production | Govyn API key transits plaintext HTTP | SDK should warn (not hard-fail) when `proxy_url` is `http://` and the target is not localhost |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Opaque authentication errors when the proxy is unreachable | User sees `openai.APIConnectionError: Connection error` — unclear if it's the proxy or OpenAI | SDK should catch connection errors to the proxy URL and raise `GovynProxyError: Cannot reach proxy at {proxy_url}` |
| Silent fallback to "unknown" agent when agent ID is not set | All costs and policies apply to the wrong agent; budget enforcement is effectively disabled | Raise a clear error if agent ID is not provided at construction time: `GovynConfigError: agent_id is required` |
| No proxy URL validation on construction | User typo in proxy_url fails at request time, not at SDK construction | Validate `proxy_url` is a parseable URL at `govynai.openai()` call time |
| Streaming returns a different type than the native SDK | Users must learn a new API surface | Return exactly what the native SDK returns (the same stream object type); govynai must be a pass-through, not a re-implementation |
| Different behavior with `stream=True` vs `stream=False` | Users see inconsistent agent identification because one path misses the header | Test both streaming and non-streaming paths in integration tests; the `default_headers` approach covers both automatically |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Header injection:** `X-Govyn-Agent` appears in streaming requests — verify with a real proxy + streaming test, not just unit tests mocking the HTTP layer
- [ ] **URL construction:** End-to-end test that hits a real proxy instance and routes correctly — the unit test of URL formatting is insufficient; the integration test catches double-slash edge cases
- [ ] **Retry disabled:** Verify `max_retries=0` is actually sent; some SDK versions have validation that ignores invalid retry values silently
- [ ] **Type safety:** Python govynai package checked with mypy strict mode; Node.js SDK checked with `tsc --strict`; both publish type declarations
- [ ] **CJS compatibility:** The govyn Node.js SDK tested with `require()` from a non-ESM project (Create a test that explicitly `require()`s the package in a CJS module)
- [ ] **Stream cleanup:** Run 25 sequential streaming requests through govynai and verify no pool exhaustion or hanging connections
- [ ] **Proxy unreachable error:** Verify the SDK raises a clear, govyn-specific error when the proxy URL is wrong, not a confusing httpx/fetch error
- [ ] **API key confusion:** Documentation makes clear that the API key passed to the SDK is a govyn key, not an OpenAI/Anthropic key

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| base_url construction bug causes all requests to 404 | LOW | Publish a patch release with corrected default URL; add regression test |
| Retry logic causes double billing for users | MEDIUM | Publish patch with `max_retries=0`; document manual refund path via dashboard; consider server-side idempotency key support |
| ESM/CJS packaging failure | MEDIUM | Publish a new version with tsup dual-format build; users on broken version need to pin until they upgrade |
| Agent header not forwarded (silent) | HIGH | Requires users to re-examine all historical cost data; add migration note; publish patch; all previously-"unknown" costs cannot be retroactively attributed |
| Stream not closed / pool exhaustion in production | MEDIUM | Patch the SDK; users restart their agents; the fix is in the next SDK version |
| `proxies=` kwarg error on SDK upgrade | LOW | Document the correct pattern; publish patch removing any `proxies=` references |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| base_url path construction (double slashes, wrong prefix) | Python SDK Phase + Node.js SDK Phase | End-to-end integration test: call govynai, confirm proxy receives request at correct path |
| SDK retry double billing | Python SDK Phase + Node.js SDK Phase | Verify `max_retries=0` in constructed client; test that proxy receives exactly one request per SDK call |
| SSE stream connection not returned to pool | Python SDK Phase | Sequential streaming test (25 calls), verify no pool exhaustion |
| `proxies=` kwarg removed | Python SDK Phase | CI tests with openai-python ≥1.56 and anthropic-sdk-python current; no `proxies=` usage anywhere |
| Agent header not forwarded | Python SDK Phase + Node.js SDK Phase | Integration test captures proxy logs and verifies `X-Govyn-Agent` header present on every request |
| ESM/CJS dual-format | Node.js SDK Phase | Automated test that both `require()` and `import` work; both `.d.ts` and `.d.cts` present in published package |
| Anthropic version header override | Python SDK Phase | Test: govynai default_headers must not include `anthropic-version`; verify proxy receives SDK-native version header |
| Silent unknown agent fallback | Python SDK Phase + Node.js SDK Phase | SDK raises error at construction if `agent_id` is not set |

---

## Sources

- OpenAI Python SDK issue #763: Connection not returned to pool after streaming — https://github.com/openai/openai-python/issues/763 (FIXED in 1.2.3)
- OpenAI SDK breaking change — `proxies` kwarg removed in 1.56.0 when httpx 0.28.0 dropped it: https://community.openai.com/t/error-with-openai-1-56-0-client-init-got-an-unexpected-keyword-argument-proxies/1040332
- OpenAI Community: `/v1/chat/completions/chat/completions/` double-path bug: https://community.openai.com/t/404-invalid-url-post-v1-chat-completions-chat-completions/680371
- Trailing slash in api_base for OpenAI-compatible proxy causing 404: https://github.com/sigoden/aichat/issues/767
- LiteLLM invalid URL construction bug with base_url: https://github.com/BerriAI/litellm/issues/13693
- FallbackModel + SDK retry conflict (double retry problem): https://github.com/pydantic/pydantic-ai/issues/3267
- Anthropic SDK: `default_headers` pattern and header merge order: https://deepwiki.com/anthropics/anthropic-sdk-python/4.4-request-lifecycle-and-retry-logic
- Custom HTTP clients and proxies in openai-python: https://deepwiki.com/openai/openai-python/7.4-custom-http-clients-and-proxies
- TypeScript ESM/CJS dual publishing complexity in 2025: https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing
- PEP 561 — Python type stub distribution standard: https://peps.python.org/pep-0561/
- httpx streaming response not closed resource leak: https://github.com/encode/httpx/issues/978
- Govyn proxy source: `src/providers/openai.ts`, `src/providers/anthropic.ts`, `src/router.ts`, `src/streaming.ts`

---
*Pitfalls research for: Drop-in replacement SDK (govynai + govyn) routing through Govyn proxy*
*Researched: 2026-02-28*
