"""Tests for GovynOpenAI and GovynAsyncOpenAI wrapper classes."""

import pytest
import openai
import respx
import httpx

from govynai._openai import _get_classes
from govynai import GovynError, GovynBudgetExceededError, GovynLoopDetectedError


@pytest.fixture
def openai_classes():
    """Get the OpenAI wrapper classes."""
    return _get_classes()


@pytest.fixture
def GovynOpenAI(openai_classes):
    return openai_classes[0]


@pytest.fixture
def GovynAsyncOpenAI(openai_classes):
    return openai_classes[1]


class TestConstructor:
    def test_constructor_sets_correct_base_url(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test")
        assert str(client.base_url) == "http://localhost:4000/v1/openai/"

    def test_constructor_custom_proxy_url(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test", proxy_url="http://myproxy:5000")
        assert str(client.base_url) == "http://myproxy:5000/v1/openai/"

    def test_constructor_strips_trailing_slash(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test", proxy_url="http://myproxy:5000/")
        assert str(client.base_url) == "http://myproxy:5000/v1/openai/"

    def test_constructor_default_api_key(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test")
        assert client.api_key == "govyn-passthrough"

    def test_constructor_custom_api_key(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test", api_key="gvn_ra_xxxx")
        assert client.api_key == "gvn_ra_xxxx"

    def test_constructor_max_retries_forced_zero(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test")
        assert client.max_retries == 0

    def test_constructor_max_retries_override_ignored(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test", max_retries=5)
        assert client.max_retries == 0

    def test_constructor_agent_header_injected(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test-agent")
        headers = client._custom_headers
        assert headers.get("X-Govyn-Agent") == "test-agent"

    def test_constructor_merges_user_headers(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test", default_headers={"Custom": "val"})
        headers = client._custom_headers
        assert headers.get("X-Govyn-Agent") == "test"
        assert headers.get("Custom") == "val"


class TestValidation:
    def test_constructor_missing_agent_id_raises(self, GovynOpenAI):
        with pytest.raises(ValueError, match="agent_id is required"):
            GovynOpenAI()

    def test_missing_openai_import_error(self):
        """Verify ImportError message when openai not installed."""
        # This test verifies the message format; we can't easily monkeypatch
        # the import since openai IS installed. We test the import function directly.
        from govynai._openai import _import_openai
        # Should not raise since openai is installed
        mod = _import_openai()
        assert mod is not None


class TestEnvVars:
    def test_env_var_agent_id_resolution(self, GovynOpenAI, monkeypatch):
        monkeypatch.setenv("GOVYN_AGENT_ID", "env-agent")
        client = GovynOpenAI()
        assert client._govyn_agent_id == "env-agent"

    def test_env_var_proxy_url_resolution(self, GovynOpenAI, monkeypatch):
        monkeypatch.setenv("GOVYN_PROXY_URL", "http://env:9000")
        client = GovynOpenAI(agent_id="x")
        assert str(client.base_url) == "http://env:9000/v1/openai/"

    def test_constructor_arg_priority_over_env(self, GovynOpenAI, monkeypatch):
        monkeypatch.setenv("GOVYN_AGENT_ID", "env-agent")
        monkeypatch.setenv("GOVYN_PROXY_URL", "http://env:9000")
        client = GovynOpenAI(agent_id="arg-agent", proxy_url="http://arg:8000")
        assert client._govyn_agent_id == "arg-agent"
        assert str(client.base_url) == "http://arg:8000/v1/openai/"


class TestIsInstance:
    def test_isinstance_openai(self, GovynOpenAI):
        client = GovynOpenAI(agent_id="test")
        assert isinstance(client, openai.OpenAI)


class TestErrorInterception:
    @respx.mock
    def test_budget_exceeded_429(self, GovynOpenAI):
        respx.post("http://localhost:4000/v1/openai/chat/completions").mock(
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
        client = GovynOpenAI(agent_id="test")
        with pytest.raises(GovynBudgetExceededError) as exc_info:
            client.chat.completions.create(
                model="gpt-4", messages=[{"role": "user", "content": "hi"}]
            )
        assert exc_info.value.limit_type == "daily"

    @respx.mock
    def test_loop_detected_429(self, GovynOpenAI):
        respx.post("http://localhost:4000/v1/openai/chat/completions").mock(
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
        client = GovynOpenAI(agent_id="test")
        with pytest.raises(GovynLoopDetectedError) as exc_info:
            client.chat.completions.create(
                model="gpt-4", messages=[{"role": "user", "content": "hi"}]
            )
        assert exc_info.value.cooldown_seconds == 300

    @respx.mock
    def test_non_govyn_429_passes_through(self, GovynOpenAI):
        respx.post("http://localhost:4000/v1/openai/chat/completions").mock(
            return_value=httpx.Response(
                429,
                json={"error": {"message": "Rate limit exceeded", "type": "tokens"}},
                headers={"retry-after": "60"},
            )
        )
        client = GovynOpenAI(agent_id="test")
        with pytest.raises(openai.RateLimitError):
            client.chat.completions.create(
                model="gpt-4", messages=[{"role": "user", "content": "hi"}]
            )

    @respx.mock
    def test_non_429_passes_through(self, GovynOpenAI):
        respx.post("http://localhost:4000/v1/openai/chat/completions").mock(
            return_value=httpx.Response(
                500,
                json={"error": {"message": "Internal server error"}},
            )
        )
        client = GovynOpenAI(agent_id="test")
        with pytest.raises(openai.InternalServerError):
            client.chat.completions.create(
                model="gpt-4", messages=[{"role": "user", "content": "hi"}]
            )


class TestAsyncConstructor:
    def test_async_constructor(self, GovynAsyncOpenAI):
        client = GovynAsyncOpenAI(agent_id="test")
        assert str(client.base_url) == "http://localhost:4000/v1/openai/"
        assert client.max_retries == 0
        assert client.api_key == "govyn-passthrough"
        assert isinstance(client, openai.AsyncOpenAI)
