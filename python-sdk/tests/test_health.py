"""Tests for check_proxy() health check utility."""

import pytest
import httpx
import respx

from govynai._health import check_proxy, async_check_proxy


class TestCheckProxy:
    @respx.mock
    def test_check_proxy_healthy(self):
        respx.get("http://localhost:4000/health").mock(
            return_value=httpx.Response(200, json={"status": "ok", "version": "0.0.1", "uptime_seconds": 123})
        )
        assert check_proxy("http://localhost:4000") is True

    @respx.mock
    def test_check_proxy_unhealthy_status(self):
        respx.get("http://localhost:4000/health").mock(
            return_value=httpx.Response(200, json={"status": "error"})
        )
        assert check_proxy("http://localhost:4000") is False

    @respx.mock
    def test_check_proxy_non_200(self):
        respx.get("http://localhost:4000/health").mock(
            return_value=httpx.Response(500, json={"status": "ok"})
        )
        assert check_proxy("http://localhost:4000") is False

    @respx.mock
    def test_check_proxy_connection_error(self):
        respx.get("http://localhost:4000/health").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        assert check_proxy("http://localhost:4000") is False

    @respx.mock
    def test_check_proxy_default_url(self):
        route = respx.get("http://localhost:4000/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        assert check_proxy() is True
        assert route.called

    @respx.mock
    def test_check_proxy_custom_url(self):
        route = respx.get("http://myproxy:5000/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        assert check_proxy("http://myproxy:5000") is True
        assert route.called

    @respx.mock
    def test_check_proxy_trailing_slash(self):
        route = respx.get("http://myproxy:5000/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        assert check_proxy("http://myproxy:5000/") is True
        assert route.called


class TestAsyncCheckProxy:
    @respx.mock
    @pytest.mark.asyncio
    async def test_async_check_proxy_healthy(self):
        respx.get("http://localhost:4000/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        result = await async_check_proxy("http://localhost:4000")
        assert result is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_check_proxy_connection_error(self):
        respx.get("http://localhost:4000/health").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        result = await async_check_proxy("http://localhost:4000")
        assert result is False
