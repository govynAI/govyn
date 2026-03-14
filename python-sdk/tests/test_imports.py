"""Tests for import ergonomics, lazy imports, and package metadata."""

import subprocess
import sys
from pathlib import Path

import pytest


class TestFlatImports:
    def test_flat_imports(self):
        from govynai import (
            GovynOpenAI,
            GovynAsyncOpenAI,
            GovynAnthropic,
            GovynAsyncAnthropic,
            GovynError,
            GovynBudgetExceededError,
            GovynLoopDetectedError,
            check_proxy,
        )
        assert GovynOpenAI is not None
        assert GovynAsyncOpenAI is not None
        assert GovynAnthropic is not None
        assert GovynAsyncAnthropic is not None
        assert GovynError is not None
        assert GovynBudgetExceededError is not None
        assert GovynLoopDetectedError is not None
        assert check_proxy is not None


class TestAllSymbols:
    def test_all_symbols_in_all(self):
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


class TestVersion:
    def test_version(self):
        import govynai
        assert govynai.__version__ == "0.2.1"


class TestPyTyped:
    def test_py_typed_exists(self):
        import govynai
        py_typed = Path(govynai.__file__).parent / "py.typed"
        assert py_typed.exists(), f"py.typed not found at {py_typed}"


class TestLazyImports:
    def test_lazy_import_no_openai_at_module_load(self):
        """After 'import govynai', openai should NOT be in sys.modules."""
        # Use subprocess for clean module state
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


class TestClassIdentity:
    def test_class_identity_preserved(self):
        import govynai
        cls1 = govynai.GovynOpenAI
        cls2 = govynai.GovynOpenAI
        assert cls1 is cls2, "Class identity not preserved across repeated access"


class TestUnknownAttribute:
    def test_unknown_attribute_raises(self):
        import govynai
        with pytest.raises(AttributeError, match="NonExistent"):
            _ = govynai.NonExistent


class TestMissingDependencyErrors:
    def test_missing_openai_import_error(self):
        """Verify ImportError message when openai is not installed."""
        script = (
            "import sys\n"
            "sys.modules['openai'] = None\n"
            "from govynai._openai import _import_openai\n"
            "try:\n"
            "    _import_openai()\n"
            "except ImportError as e:\n"
            "    print(str(e))\n"
            "else:\n"
            "    print('NO_ERROR')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, f"subprocess failed: {result.stderr}"
        output = result.stdout.strip()
        assert "pip install govynai[openai]" in output

    def test_missing_anthropic_import_error(self):
        """Verify ImportError message when anthropic is not installed."""
        script = (
            "import sys\n"
            "sys.modules['anthropic'] = None\n"
            "from govynai._anthropic import _import_anthropic\n"
            "try:\n"
            "    _import_anthropic()\n"
            "except ImportError as e:\n"
            "    print(str(e))\n"
            "else:\n"
            "    print('NO_ERROR')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, f"subprocess failed: {result.stderr}"
        output = result.stdout.strip()
        assert "pip install govynai[anthropic]" in output
