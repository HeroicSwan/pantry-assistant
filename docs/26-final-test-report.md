# Final test report

The final validation report records only commands actually executed. The application is validated with clean test-database reset/migration/seed, Vitest unit and integration suites, background-job tests, system-specific SMS/assistant/report suites, Playwright desktop/mobile journeys, WCAG A/AA automated accessibility checks, lint, strict TypeScript, and the Next.js production build.

Infrastructure: native PostgreSQL 18 Windows service on localhost, separate `food_pantry_dev` and `food_pantry_test` databases, and non-superuser application credentials. Supabase/Docker commands are inapplicable because those dependencies were intentionally removed.

Latest local validation: 98 unit tests, 48 integration tests, 30 Playwright browser tests (Chromium and mobile), `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. The browser run used an isolated port and the test database because port 3000 was occupied by an unrelated application. Development migration and test reset/migration/seed passed, and the development and test databases currently report twelve applied migrations. A custom-format backup was restored into a temporary database and verified at 96 public tables before cleanup. A clean second-PC packaged-install run remains outstanding.

External limitations: no live SMS message, public webhook delivery, SMTP delivery, OpenAI API call, Vercel deployment, LAN TLS trust test, or external accessibility audit can be claimed without provider credentials/public infrastructure. All ten SMS connector adapters are present and compile-tested; simulation and disabled-provider behavior are tested locally.

See the final task response for exact passing counts and any unresolved failures from the last repair loop.
