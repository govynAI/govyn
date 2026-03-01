"""Tests for GovynAnthropic and GovynAsyncAnthropic wrapper classes."""

import pytest
import anthropic
import respx
import httpx

from govynai._anthropic import _get_classes
from govynai import GovynError, GovynBudgetExceededError, GovynLoopDetectedError


@pytest.fixture
def anthropic_classes():
    """Get the Anthropic wrapper classes."""
    return _get_classes()


@pytest.fixture
def GovynAnthropic(anthropic_classes):
    return anthropic_classes[0]


@pytest.fixture
def GovynAsyncAnthropic(anthropic_classes):
    return anthropic_classes[1]


class TestConstructor:
    def test_constructor_sets_correct_base_url(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test")
        assert str(client.base_url) == "http://localhost:4000/v1/anthropic/"

    def test_constructor_custom_proxy_url(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test", proxy_url="http://myproxy:5000")
        assert str(client.base_url) == "http://myproxy:5000/v1/anthropic/"

    def test_constructor_strips_trailing_slash(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test", proxy_url="http://myproxy:5000/")
        assert str(client.base_url) == "http://myproxy:5000/v1/anthropic/"

    def test_constructor_default_api_key(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test")
        assert client.api_key == "govyn-passthrough"

    def test_constructor_custom_api_key(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test", api_key="gvn_ra_xxxx")
        assert client.api_key == "gvn_ra_xxxx"

    def test_constructor_max_retries_forced_zero(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test")
        assert client.max_retries == 0

    def test_constructor_max_retries_override_ignored(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test", max_retries=5)
        assert client.max_retries == 0

    def test_constructor_agent_header_injected(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test-agent")
        headers = client._custom_headers
        assert headers.get("X-Govyn-Agent") == "test-agent"

    def test_constructor_merges_user_headers(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test", default_headers={"Custom": "val"})
        headers = client._custom_headers
        assert headers.get("X-Govyn-Agent") == "test"
        assert headers.get("Custom") == "val"


class TestValidation:
    def test_constructor_missing_agent_id_raises(self, GovynAnthropic):
        with pytest.raises(ValueError, match="agent_id is required"):
            GovynAnthropic()


class TestEnvVars:
    def test_env_var_agent_id_resolution(self, GovynAnthropic, monkeypatch):
        monkeypatch.setenv("GOVYN_AGENT_ID", "env-agent")
        client = GovynAnthropic()
        assert client._govyn_agent_id == "env-agent"

    def test_env_var_proxy_url_resolution(self, GovynAnthropic, monkeypatch):
        monkeypatch.setenv("GOVYN_PROXY_URL", "http://env:9000")
        client = GovynAnthropic(agent_id="x")
        assert str(client.base_url) == "http://env:9000/v1/anthropic/"

    def test_constructor_arg_priority_over_env(self, GovynAnthropic, monkeypatch):
        monkeypatch.setenv("GOVYN_AGENT_ID", "env-agent")
        monkeypatch.setenv("GOVYN_PROXY_URL", "http://env:9000")
        client = GovynAnthropic(agent_id="arg-agent", proxy_url="http://arg:8000")
        assert client._govyn_agent_id == "arg-agent"
        assert str(client.base_url) == "http://arg:8000/v1/anthropic/"


class TestIsInstance:
    def test_isinstance_anthropic(self, GovynAnthropic):
        client = GovynAnthropic(agent_id="test")
        assert isinstance(client, anthropic.Anthropic)


class TestErrorInterception:
    @respx.mock
    def test_budget_exceeded_429(self, GovynAnthropic):
        respx.post("http://localhost:4000/v1/anthropic/v1/messages").mock(
            return_value=httpx.Response(
                429,
                json={
                    "error": {
                        "type": "budget_error",
                        "code": "budget_exceeded_daily",
                        "message": "Budget exceeded",
                        "details": {
                            "limit_type": "daily",
                            "limit_amount": 10.0,
                            "current_spend": 10.5,
                            "reset_time": "2026-03-02T00:00:00Z",
                            "agent_id": "test",
                        },
                    }
                },
                headers={"retry-after": "3600"},
            )
        )
        client = GovynAnthropic(agent_id="test")
        with pytest.raises(GovynBudgetExceededError) as exc_info:
            client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=100,
                messages=[{"role": "user", "content": "hi"}],
            )
        assert exc_info.value.limit_type == "daily"

    @respx.mock
    def test_loop_detected_429(self, GovynAnthropic):
        respx.post("http://localhost:4000/v1/anthropic/v1/messages").mock(
            return_value=httpx.Response(
                429,
                json={
                    "error": {
                        "type": "loop_error",
                        "code": "loop_detected",
                        "message": "Loop detected",
                        "details": {
                            "agent_id": "test",
                            "cooldown_seconds": 300,
                            "cooldown_expires_at": "2026-03-01T12:05:00Z",
                        },
                    }
                },
                headers={"retry-after": "300"},
            )
        )
        client = GovynAnthropic(agent_id="test")
        with pytest.raises(GovynLoopDetectedError) as exc_info:
            client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=100,
                messages=[{"role": "user", "content": "hi"}],
            )
        assert exc_info.value.cooldown_seconds == 300

    @respx.mock
    def test_non_govyn_429_passes_through(self, GovynAnthropic):
        respx.post("http://localhost:4000/v1/anthropic/v1/messages").mock(
            return_value=httpx.Response(
                429,
                json={"error": {"message": "Rate limit exceeded", "type": "tokens"}},
                headers={"retry-after": "60"},
            )
        )
        client = GovynAnthropic(agent_id="test")
        with pytest.raises(anthropic.RateLimitError):
            client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=100,
                messages=[{"role": "user", "content": "hi"}],
            )


class TestAsyncConstructor:
    def test_async_constructor(self, GovynAsyncAnthropic):
        client = GovynAsyncAnthropic(agent_id="test")
        assert str(client.base_url) == "http://localhost:4000/v1/anthropic/"
        assert client.max_retries == 0
        assert client.api_key == "govyn-passthrough"
        assert isinstance(client, anthropic.AsyncAnthropic)
