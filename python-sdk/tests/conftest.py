"""Shared fixtures for govynai test suite."""

import pytest


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Remove Govyn and upstream SDK env vars to prevent leakage between tests."""
    for var in [
        "GOVYN_PROXY_URL",
        "GOVYN_AGENT_ID",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
    ]:
        monkeypatch.delenv(var, raising=False)
