# govynai

Python SDK for the Govyn governance proxy.

`govynai` gives Python agents a small client layer that points requests at a self-hosted Govyn proxy, adds agent identity headers, and turns proxy governance responses into typed Python exceptions.

## Install

```bash
pip install govynai[all]
```

Optional extras:

```bash
pip install govynai[openai]
pip install govynai[anthropic]
```

## Quick Start

```python
from govynai import GovynOpenAI

client = GovynOpenAI(agent_id="research-agent")
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
```

The client reads the proxy URL from `GOVYN_PROXY_URL` by default and targets `http://localhost:4000` if it is not set.

## Local Health Check

```python
from govynai import check_proxy

if not check_proxy():
    raise SystemExit("Govyn proxy is not reachable")
```

## Links

- Repository: [github.com/govynAI/govyn](https://github.com/govynAI/govyn)
- Issues: [github.com/govynAI/govyn/issues](https://github.com/govynAI/govyn/issues)
