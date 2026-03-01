"""Tests for the Govyn error hierarchy and parse function."""

from govynai._errors import (
    GovynBudgetExceededError,
    GovynError,
    GovynLoopDetectedError,
    _parse_govyn_error,
)


class TestErrorHierarchy:
    def test_govyn_error_is_exception(self):
        assert issubclass(GovynError, Exception)

    def test_govyn_error_base_is_exception_only(self):
        """GovynError inherits directly from Exception, not upstream SDK errors."""
        assert GovynError.__bases__ == (Exception,)

    def test_budget_exceeded_is_govyn_error(self):
        assert issubclass(GovynBudgetExceededError, GovynError)

    def test_loop_detected_is_govyn_error(self):
        assert issubclass(GovynLoopDetectedError, GovynError)


class TestBudgetExceededError:
    def test_budget_exceeded_daily(self):
        err = _parse_govyn_error(
            {
                "type": "budget_error",
                "code": "budget_exceeded_daily",
                "message": "Agent has exceeded its daily budget limit",
                "details": {
                    "limit_type": "daily",
                    "limit_amount": 10.00,
                    "current_spend": 10.50,
                    "reset_time": "2026-03-02T00:00:00.000Z",
                    "agent_id": "research-agent",
                },
            }
        )
        assert isinstance(err, GovynBudgetExceededError)
        assert err.code == "budget_exceeded_daily"
        assert err.limit_type == "daily"
        assert err.limit_amount == 10.00
        assert err.current_spend == 10.50
        assert err.reset_time == "2026-03-02T00:00:00.000Z"
        assert err.agent_id == "research-agent"
        assert str(err) == "Agent has exceeded its daily budget limit"

    def test_budget_exceeded_monthly(self):
        err = _parse_govyn_error(
            {
                "type": "budget_error",
                "code": "budget_exceeded_monthly",
                "message": "Agent has exceeded its monthly budget limit",
                "details": {
                    "limit_type": "monthly",
                    "limit_amount": 100.00,
                    "current_spend": 105.00,
                    "reset_time": "2026-04-01T00:00:00.000Z",
                    "agent_id": "deploy-agent",
                },
            }
        )
        assert isinstance(err, GovynBudgetExceededError)
        assert err.code == "budget_exceeded_monthly"
        assert err.limit_type == "monthly"
        assert err.limit_amount == 100.00
        assert err.current_spend == 105.00
        assert err.agent_id == "deploy-agent"

    def test_budget_exceeded_catchable_as_govyn_error(self):
        """GovynBudgetExceededError can be caught as GovynError."""
        exc = GovynBudgetExceededError(
            "test",
            code="budget_exceeded_daily",
            limit_type="daily",
            limit_amount=10.0,
            current_spend=11.0,
            reset_time="2026-03-02T00:00:00.000Z",
            agent_id="test-agent",
        )
        try:
            raise exc
        except GovynError as caught:
            assert caught is exc
        else:
            raise AssertionError("GovynBudgetExceededError not caught as GovynError")


class TestLoopDetectedError:
    def test_loop_detected(self):
        err = _parse_govyn_error(
            {
                "type": "loop_error",
                "code": "loop_detected",
                "message": "Agent blocked: repeated identical requests detected",
                "details": {
                    "agent_id": "research-agent",
                    "cooldown_seconds": 300,
                    "cooldown_expires_at": "2026-03-01T12:05:00.000Z",
                },
            }
        )
        assert isinstance(err, GovynLoopDetectedError)
        assert str(err) == "Agent blocked: repeated identical requests detected"
        assert err.agent_id == "research-agent"
        assert err.cooldown_seconds == 300
        assert err.cooldown_expires_at == "2026-03-01T12:05:00.000Z"

    def test_loop_detected_catchable_as_govyn_error(self):
        """GovynLoopDetectedError can be caught as GovynError."""
        exc = GovynLoopDetectedError(
            "test",
            agent_id="test-agent",
            cooldown_seconds=300,
            cooldown_expires_at="2026-03-01T12:05:00.000Z",
        )
        try:
            raise exc
        except GovynError as caught:
            assert caught is exc
        else:
            raise AssertionError("GovynLoopDetectedError not caught as GovynError")


class TestParseReturnsNone:
    def test_non_govyn_error_returns_none(self):
        assert _parse_govyn_error({"message": "Rate limit exceeded", "type": "tokens"}) is None

    def test_empty_dict_returns_none(self):
        assert _parse_govyn_error({}) is None

    def test_unknown_type_returns_none(self):
        assert _parse_govyn_error({"type": "unknown", "code": "something"}) is None


class TestFlatImport:
    def test_flat_import(self):
        from govynai import GovynBudgetExceededError, GovynError, GovynLoopDetectedError

        assert issubclass(GovynBudgetExceededError, GovynError)
        assert issubclass(GovynLoopDetectedError, GovynError)
