# Changelog

## 0.2.6

### Security

- IPv6 SSRF protection: block loopback, link-local, ULA, and IPv4-mapped IPv6 addresses
- DNS rebinding defense: resolve hostnames at fetch time, reject private IPs post-resolution
- ReDoS protection: validate user-supplied regex patterns against catastrophic backtracking before compilation
- Content filter scoping: evaluate patterns against extracted message content only, not request metadata

### Documentation

- Add Govyn Cloud section to README
- Update README with v1.2 security feature descriptions

### Fixes

- Generate release notes from git log instead of hardcoded template

## 0.2.5

- Release automation and CI improvements
- Dashboard build and Docker packaging

## 0.2.4

- CodeQL security scanning
- CI workflow action upgrades

## 0.2.3

- Policy engine enhancements
- Content filtering with PII detection

## 0.2.2

- Loop detection for repetitive agent call patterns
- Action logging improvements

## 0.2.1

- Multi-provider support (OpenAI + Anthropic)
- Python SDK (`govynai` package)

## 0.2.0

- Initial public release
- Per-agent budgets, cost tracking, policy engine
- YAML-based configuration
- SQLite and PostgreSQL persistence
