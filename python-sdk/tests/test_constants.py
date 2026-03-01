"""Tests for govynai._constants module and package scaffold."""

from __future__ import annotations


def test_header_agent():
    from govynai._constants import HEADER_AGENT

    assert HEADER_AGENT == "X-Govyn-Agent"


def test_default_proxy_url():
    from govynai._constants import DEFAULT_PROXY_URL

    assert DEFAULT_PROXY_URL == "http://localhost:4000"


def test_default_api_key():
    from govynai._constants import DEFAULT_API_KEY

    assert DEFAULT_API_KEY == "govyn-passthrough"


def test_route_openai():
    from govynai._constants import ROUTE_OPENAI

    assert ROUTE_OPENAI == "/v1/openai"


def test_route_anthropic():
    from govynai._constants import ROUTE_ANTHROPIC

    assert ROUTE_ANTHROPIC == "/v1/anthropic"


def test_env_proxy_url():
    from govynai._constants import ENV_PROXY_URL

    assert ENV_PROXY_URL == "GOVYN_PROXY_URL"


def test_env_agent_id():
    from govynai._constants import ENV_AGENT_ID

    assert ENV_AGENT_ID == "GOVYN_AGENT_ID"


def test_health_endpoint():
    from govynai._constants import HEALTH_ENDPOINT

    assert HEALTH_ENDPOINT == "/health"


def test_py_typed_marker_exists():
    import pathlib

    marker = pathlib.Path(__file__).resolve().parent.parent / "govynai" / "py.typed"
    assert marker.exists(), f"py.typed marker not found at {marker}"


def test_import_govynai_does_not_import_providers():
    """Importing govynai should NOT eagerly import openai or anthropic."""
    import sys

    # Clear any cached imports
    for mod in list(sys.modules.keys()):
        if mod.startswith("govynai"):
            del sys.modules[mod]

    import govynai  # noqa: F401

    assert "openai" not in sys.modules, "openai was eagerly imported"
    assert "anthropic" not in sys.modules, "anthropic was eagerly imported"


def test_govynai_version():
    import govynai

    assert govynai.__version__ == "0.1.0"


def test_govynai_all_exports():
    import govynai

    expected = {
        "GovynOpenAI",
        "GovynAsyncOpenAI",
        "GovynAnthropic",
        "GovynAsyncAnthropic",
        "GovynError",
        "GovynBudgetExceededError",
        "GovynLoopDetectedError",
        "check_proxy",
    }
    assert set(govynai.__all__) == expected
