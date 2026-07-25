## What and why

<!-- One or two sentences. Link the roadmap phase or issue. -->

## Definition of done

<!-- From docs/06-roadmap.md. Tick what applies; delete what genuinely does not. -->

- [ ] Lint, typecheck, unit and integration tests pass locally
- [ ] New rules are covered by tests, including at least one failure case
- [ ] Public functions documented; non-obvious decisions commented with _why_
- [ ] No new `any`, no `@ts-expect-error` without a linked issue
- [ ] Error paths return typed `AppError`s with client-mapped copy
- [ ] New environment variables added to the Zod schema, `.env.example` and `docs/09-deployment.md`
- [ ] Anonymity regression suite still green

## Anonymity impact

<!--
Anonymity is the product, so this section is not optional. If this PR touches game payloads,
WebSocket events, logging or the reveal flow, say what changed and which assertion in
docs/08-testing.md covers it. If it does not, write "none".
-->

## Screenshots / notes for the reviewer

<!-- Light and dark, mobile and desktop, for UI changes. -->
