# Contributing to Govyn

Thanks for your interest in contributing to Govyn! This document covers the process for submitting changes and reporting issues.

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+ (for the Python SDK)
- npm

### Development Setup

```bash
# Clone the repo
git clone https://github.com/govynAI/govyn.git
cd govyn

# Install Node dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start dev server (auto-reload)
npm run dev
```

### Python SDK Setup

```bash
cd python-sdk
pip install -e ".[dev]"
pytest
```

## Making Changes

### Branch Naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes

### Code Style

**TypeScript (proxy):**
- ESLint configuration is provided — run `npm run lint` before submitting
- Use `npm run typecheck` to verify type safety
- Prefer explicit types over `any`
- Use early returns to reduce nesting

**Python (SDK):**
- Follow PEP 8
- Use type hints on all public APIs
- Keep dependencies minimal — the SDK should be lightweight

### Commit Messages

Use conventional commits:

```
feat: add rate limiting to policy engine
fix: correct token count for streaming responses
docs: update quickstart with Docker instructions
test: add budget enforcer edge cases
```

### Tests

- All changes should include tests
- Proxy tests: `npm test` (Vitest)
- Python SDK tests: `cd python-sdk && pytest`
- Don't break existing tests

## Pull Request Process

1. Fork the repository and create your branch from `main`
2. Make your changes with tests
3. Ensure all tests pass (`npm test` and `cd python-sdk && pytest`)
4. Run linting (`npm run lint`)
5. Update documentation if you changed user-facing behavior
6. Open a PR with a clear title and description

### PR Description Template

```
## What

Brief description of the change.

## Why

What problem does this solve?

## How

High-level approach taken.

## Testing

How was this tested?
```

### Review Process

- PRs require at least one approval before merging
- CI must pass (lint, typecheck, tests)
- Keep PRs focused — one logical change per PR

## Reporting Issues

### Bug Reports

Open an issue with:

- **What happened** — Clear description of the bug
- **What you expected** — What should have happened instead
- **How to reproduce** — Steps, config, and environment details
- **Environment** — Node version, OS, Govyn version

### Feature Requests

Open an issue with:

- **Problem** — What are you trying to do?
- **Proposed solution** — How you'd like it to work
- **Alternatives considered** — Other approaches you thought about

## Project Structure

```
govyn/
├── src/              # Proxy server source (TypeScript)
│   ├── providers/    # OpenAI, Anthropic, custom provider adapters
│   ├── proxy.ts      # Core proxy logic
│   ├── budget-enforcer.ts
│   ├── loop-detector.ts
│   ├── policy-engine.ts
│   └── cli.ts        # CLI entry point
├── python-sdk/       # Python SDK (govynai)
│   ├── govynai/      # Package source
│   └── tests/        # SDK tests
├── configs/          # Example configurations
├── templates/        # Init wizard templates
└── tests/            # Proxy tests
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
