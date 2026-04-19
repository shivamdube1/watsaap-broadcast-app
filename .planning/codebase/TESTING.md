# Testing

## Frameworks
- **Vitest**: primary testing engine.
- **Supertest**: for API endpoint validation.

## Methodology
- **Mocking**: Extensive use of `vi.mock` for the WhatsApp socket to allow testing logic without a live phone connection.
- **E2E (Browser)**: Manual verification via browser tools; transitioning to automated Playwright or Puppeteer suites.

## Coverage Areas
1. **Model Validation**: Ensuring MongoDB schemas enforced required fields (JID, Name).
2. **Sync Logic**: Verifying `upsertContact` merges metadata correctly from multiple sources.
3. **API Security**: Testing `/api/*` routes for `x-api-key` protection.

## Current Audit Result (TEST_AUDIT.md)
- **Status**: 🟢 Passing (Unit tests for contact merging were successful).
- **Gap**: Need more integration tests for the `safeRestart` cycle and large-scale bulk sending.
