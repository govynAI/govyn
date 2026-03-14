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
    """Importing govynai should NOT eagerly import openai or anthropic.

    NOTE: This test uses subprocess because other tests in the same process
    may have already imported openai/anthropic, making in-process checks unreliable.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import govynai; "
                "has_openai = 'openai' in sys.modules; "
                "has_anthropic = 'anthropic' in sys.modules; "
                "print(f'{has_openai},{has_anthropic}')"
            ),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"subprocess failed: {result.stderr}"
    has_openai, has_anthropic = result.stdout.strip().split(",")
    assert has_openai == "False", "openai was eagerly imported"
    assert has_anthropic == "False", "anthropic was eagerly imported"


def test_govynai_version():
    import govynai

    assert govynai.__version__ == "0.2.2"


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
        "async_check_proxy",
    }
    assert set(govynai.__all__) == expected
