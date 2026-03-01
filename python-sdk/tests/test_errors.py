"""Tests for Govyn error hierarchy and parse function."""

from govynai import GovynError, GovynBudgetExceededError, GovynLoopDetectedError
from govynai._errors import _parse_govyn_error


class TestErrorHierarchy:
    def test_govyn_error_is_exception(self):
        assert issubclass(GovynError, Exception)

    def test_budget_exceeded_is_govyn_error(self):
        assert issubclass(GovynBudgetExceededError, GovynError)

    def test_loop_detected_is_govyn_error(self):
        assert issubclass(GovynLoopDetectedError, GovynError)


class TestBudgetExceededError:
    def test_daily_budget_exceeded(self):
        error_data = {
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
        exc = _parse_govyn_error(error_data)
        assert isinstance(exc, GovynBudgetExceededError)
        assert str(exc) == "Agent has exceeded its daily budget limit"
        assert exc.code == "budget_exceeded_daily"
        assert exc.limit_type == "daily"
        assert exc.limit_amount == 10.00
        assert exc.current_spend == 10.50
        assert exc.reset_time == "2026-03-02T00:00:00.000Z"
        assert exc.agent_id == "research-agent"

    def test_monthly_budget_exceeded(self):
        error_data = {
            "type": "budget_error",
            "code": "budget_exceeded_monthly",
            "message": "Agent has exceeded its monthly budget limit",
            "details": {
                "limit_type": "monthly",
                "limit_amount": 100.00,
                "current_spend": 105.00,
                "reset_time": "2026-04-01T00:00:00.000Z",
                "agent_id": "test-agent",
            },
        }
        exc = _parse_govyn_error(error_data)
        assert isinstance(exc, GovynBudgetExceededError)
        assert exc.code == "budget_exceeded_monthly"
        assert exc.limit_type == "monthly"


class TestLoopDetectedError:
    def test_loop_detected(self):
        error_data = {
            "type": "loop_error",
            "code": "loop_detected",
            "message": "Agent blocked: repeated identical requests detected",
            "details": {
                "agent_id": "research-agent",
                "cooldown_seconds": 300,
                "cooldown_expires_at": "2026-03-01T12:05:00.000Z",
            },
        }
        exc = _parse_govyn_error(error_data)
        assert isinstance(exc, GovynLoopDetectedError)
        assert str(exc) == "Agent blocked: repeated identical requests detected"
        assert exc.agent_id == "research-agent"
        assert exc.cooldown_seconds == 300
        assert exc.cooldown_expires_at == "2026-03-01T12:05:00.000Z"


class TestParseNonGovynErrors:
    def test_non_govyn_error_returns_none(self):
        error_data = {"message": "Rate limit exceeded", "type": "tokens"}
        assert _parse_govyn_error(error_data) is None

    def test_empty_dict_returns_none(self):
        assert _parse_govyn_error({}) is None

    def test_unknown_type_returns_none(self):
        error_data = {"type": "unknown", "code": "something"}
        assert _parse_govyn_error(error_data) is None


class TestFlatImport:
    def test_flat_import_works(self):
        from govynai import GovynError, GovynBudgetExceededError, GovynLoopDetectedError

        assert GovynError is not None
        assert GovynBudgetExceededError is not None
        assert GovynLoopDetectedError is not None
