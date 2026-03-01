"""Govyn error hierarchy and parse function.

Independent exception hierarchy: GovynError(Exception) base,
not subclassing upstream SDK errors.
"""

from __future__ import annotations


class GovynError(Exception):
    """Base exception for Govyn SDK errors."""


class GovynBudgetExceededError(GovynError):
    """Raised when an agent exceeds its budget limit."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        limit_type: str,
        limit_amount: float,
        current_spend: float,
        reset_time: str,
        agent_id: str,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.limit_type = limit_type
        self.limit_amount = limit_amount
        self.current_spend = current_spend
        self.reset_time = reset_time
        self.agent_id = agent_id


class GovynLoopDetectedError(GovynError):
    """Raised when the proxy detects repeated identical requests."""

    def __init__(
        self,
        message: str,
        *,
        agent_id: str,
        cooldown_seconds: int,
        cooldown_expires_at: str,
    ) -> None:
        super().__init__(message)
        self.agent_id = agent_id
        self.cooldown_seconds = cooldown_seconds
        self.cooldown_expires_at = cooldown_expires_at


def _parse_govyn_error(error_data: dict) -> GovynError | None:
    """Parse a Govyn error envelope and return the typed exception, or None."""
    error_type = error_data.get("type")
    code = error_data.get("code")
    message = error_data.get("message", "")
    details = error_data.get("details", {})

    if error_type == "budget_error" and code in (
        "budget_exceeded_daily",
        "budget_exceeded_monthly",
    ):
        return GovynBudgetExceededError(
            message,
            code=code,
            limit_type=details.get("limit_type", ""),
            limit_amount=details.get("limit_amount", 0.0),
            current_spend=details.get("current_spend", 0.0),
            reset_time=details.get("reset_time", ""),
            agent_id=details.get("agent_id", ""),
        )

    if error_type == "loop_error" and code == "loop_detected":
        return GovynLoopDetectedError(
            message,
            agent_id=details.get("agent_id", ""),
            cooldown_seconds=details.get("cooldown_seconds", 0),
            cooldown_expires_at=details.get("cooldown_expires_at", ""),
        )

    return None
