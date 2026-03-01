---
phase: 17
slug: python-sdk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-01
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest >=8.0 + pytest-asyncio >=1.0 + respx >=0.22.0 |
| **Config file** | `python-sdk/pyproject.toml` (tool.pytest.ini_options section) |
| **Quick run command** | `cd python-sdk && python -m pytest tests/ -x -q` |
| **Full suite command** | `cd python-sdk && python -m pytest tests/ -v` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd python-sdk && python -m pytest tests/ -x -q`
- **After every plan wave:** Run `cd python-sdk && python -m pytest tests/ -v`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | PSDK-10 | smoke | `cd python-sdk && pip install -e .[all,dev]` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | PSDK-09 | unit | `cd python-sdk && python -m pytest tests/test_imports.py::test_py_typed_exists -x` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | PSDK-01 | unit | `cd python-sdk && python -m pytest tests/test_openai.py::test_constructor_sets_correct_base_url -x` | ❌ W0 | ⬜ pending |
| 17-02-02 | 02 | 1 | PSDK-02 | unit | `cd python-sdk && python -m pytest tests/test_openai.py::test_async_constructor -x` | ❌ W0 | ⬜ pending |
| 17-02-03 | 02 | 1 | PSDK-05 | unit | `cd python-sdk && python -m pytest tests/test_openai.py::test_env_var_resolution -x` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 1 | PSDK-03 | unit | `cd python-sdk && python -m pytest tests/test_anthropic.py::test_constructor_sets_correct_base_url -x` | ❌ W0 | ⬜ pending |
| 17-03-02 | 03 | 1 | PSDK-04 | unit | `cd python-sdk && python -m pytest tests/test_anthropic.py::test_async_constructor -x` | ❌ W0 | ⬜ pending |
| 17-03-03 | 03 | 1 | PSDK-06 | unit | `cd python-sdk && python -m pytest tests/test_errors.py::test_budget_exceeded_error -x` | ❌ W0 | ⬜ pending |
| 17-03-04 | 03 | 1 | PSDK-07 | unit | `cd python-sdk && python -m pytest tests/test_errors.py::test_loop_detected_error -x` | ❌ W0 | ⬜ pending |
| 17-03-05 | 03 | 1 | PSDK-08 | unit | `cd python-sdk && python -m pytest tests/test_health.py -x` | ❌ W0 | ⬜ pending |
| 17-04-01 | 04 | 2 | PSDK-01..10 | integration | `cd python-sdk && python -m pytest tests/ -v` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `python-sdk/tests/conftest.py` — shared fixtures (monkeypatched env vars, respx setup)
- [ ] `python-sdk/tests/test_openai.py` — GovynOpenAI constructor and error interception tests
- [ ] `python-sdk/tests/test_anthropic.py` — GovynAnthropic constructor and error interception tests
- [ ] `python-sdk/tests/test_errors.py` — Error parsing and exception hierarchy tests
- [ ] `python-sdk/tests/test_health.py` — check_proxy() tests
- [ ] `python-sdk/tests/test_imports.py` — Import ergonomics, lazy import, missing provider tests

*Existing infrastructure covers: None (new package)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PyPI publish | PSDK-10 | Requires PyPI credentials and network | Run `cd python-sdk && hatch build` to verify build succeeds |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
