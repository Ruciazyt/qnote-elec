---
name: verify-todo-time
description: Prove that QNote's Rust native todo-time module and the TypeScript implementation it replaces answer identically across an enumerated input domain. Use when a change touches src/shared/todo/**, src/shared/todo/todo-rs/**, src/main/core/todo/**, when the native module is ported, re-enabled or re-compiled, or when asked to check the todo time semantics.
---

# Verify QNote todo time semantics

QNote ships two implementations of the same todo-time logic: a TypeScript reference in `src/shared/todo/` and a Rust port in `src/shared/todo/todo-rs/`. The main process prefers the Rust module and silently falls back to TypeScript when the native build is missing (`src/main/core/todo/nativeTodo.ts` → `nativeCall` in `src/main/core/system/nativeModules.ts`). Nobody reads `src/shared/todo/todo-rs/cases.jsonl`, so the two implementations were never compared against each other.

## The property

For every input in the enumerated domain below, the Rust native module and the TypeScript implementation must return the same answer — the same week range, the same boolean, the same instant, the same JS type.

## Why this one

A drift between the two is invisible to every test in the repo: `src/shared/todo/reminderTime.test.ts` only exercises the TypeScript side, and no code reads the Rust recording fixture. A drift is not hypothetical either — this check found three real defects in `fromDateTimeLocalValue` (see below). The same drift in the reminder scheduler would move a todo into or out of the "本周" tab depending on whether the machine has a working native build.

## Run it

```bash
pnpm run build:electron
pnpm run build:rust
node scripts/quality/todo-time/verify-todo-time.js
```

- `build:electron` compiles `src/shared/todo/*.ts` into `dist/shared/todo/`. `build:rust` compiles the native module into `dist/native/todo-rs.cjs`. The check runs the **compiled** artifacts, not the sources, because that is what ships.
- Without cargo installed, `dist/native/todo-rs.cjs` is missing and the check exits 1 with `不存在，先跑 pnpm run build:electron 与 pnpm run build:rust`. That is a missing artifact, not a failure of the property.
- The check also refuses to run when a source file is newer than its compiled output (`编译产物落后于源码`). Rebuild instead of investigating.
- Runtime is about one minute. Exit code `0` means every comparable time zone agreed; `1` means a mismatch, a missing artifact, or a stale build.
- One zone at a time, for debugging: `node scripts/quality/todo-time/verify-todo-time.js --child --zone Asia/Shanghai`.

## Reading the result

Each comparable zone prints one line, then a machine-readable JSON dump of the first 25 counterexamples:

```
Asia/Shanghai: 比较 289908 项，不一致 26342 项（rust-error 26298、from-local-shape 28、from-local-string 16）
```

The parenthetical breakdown is the part to read first. Each kind is one property:

| kind | what it means |
| --- | --- |
| `range` | the two implementations disagree about which days the week starts on |
| `oracle-range` | the TypeScript week range disagrees with an independent local-week oracle written inside the checker |
| `in-week` / `in-week-oracle` / `todo-week` / `current-week` | membership of a week differs |
| `day-diff` / `reminder-label` / `local-stamp` | a formatted label differs |
| `local-value` / `from-local-value` | the local datetime string differs, or the string→Date direction differs |
| `from-local-shape` | the same input returns different **JS types** (e.g. `Date` vs `{$date: "..."}`) |
| `from-local-string` | the same input resolves to a different instant |
| `resolve-reminder` | the natural-language reminder resolver picked a different moment |
| `resolve-reminder-error` | it reported a different error message for the same input |
| `expired-reminder` / `pick-due` | the due/expired decision differs |
| `rust-error` | the Rust side threw where the TypeScript side answered |
| `ts-error` | the TypeScript side threw where the Rust side answered |

### Telling a real bug from a modeling error

- A **real bug** is a counterexample whose input is inside the enumerated domain and where the two implementations genuinely disagree. The counterexample is printed in the code's terms: the exact input string, the exact row, the exact instant.
- A **modeling error** is you having changed the input domain. The domain lives in `scripts/quality/todo-time/verify-todo-time.js`: `REMINDER_PHRASES`, `NOW_INSTANTS`, `SHAPES`, `DEGENERATE`, `localValueStrings()`, the 2026 year window and the boundary sweep in `enumerateInstants()`, `ZONES`. Widening or narrowing it changes what the property means — do it deliberately and say so.
- A **platform skip** is a zone the checker refused to compare, printed as `跳过`. It is never a pass and never a failure. On this machine only `Asia/Shanghai` is comparable: Node honours the `TZ` environment variable, but chrono's `Local` follows the system time zone, so in any other zone the two sides would read different wall clocks. The checker probes both sides for exactly one probe timestamp and skips the zone when they disagree. It refuses to report a platform difference as a product defect.
- A **build problem** is a missing artifact or a stale build. Fix the build; do not edit the checker.

## What it found

At the sync commit below, the property **does not hold**. The Rust implementation of `fromDateTimeLocalValue` diverges from the TypeScript one in three ways:

1. **Panic.** `rust-error`, 26298 items. `src/shared/todo/todo-rs/src/port.rs` → `from_date_time_local_value` → `parse_js_date` panics with `no group at index '6'` on `"YYYY-MM-DDTHH:MM"` and `"YYYY-MM-DD HH:MM"`. That is exactly the format `toDateTimeLocalValue` emits, so the string→Date round-trip crashes in the native module. The TypeScript side answers normally.
2. **Wrong return type.** `from-local-shape`, 28 items. The Rust module returns the raw marker object `{"$date":"2026-12-30T04:30:00.000Z"}` instead of a `Date`. The cause is in `src/shared/todo/todo-rs/index.cjs`: the binary-wire decoder `rDyn` rebuilds objects without reviving the `$date` marker, and `fromDateTimeLocalValue` takes a string, so it takes the wire path instead of the JSON path that does revive it.
3. **Lost milliseconds.** `from-local-string`, 16 items. `"2026-12-30T12:30:00.123"` resolves to `.123` in TypeScript and to `.000` in Rust.

**Impact today: none for users.** `fromDateTimeLocalValue` has no caller in `src/main` — the renderer uses the TypeScript version directly (`src/renderer/pages/todo/TodoEditDialog.tsx:153`). The functions the main process actually calls — `resolveReminderTime`, `pickDueReminders`, `isExpiredReminder`, `formatReminderLabel` — agree on all 710 comparisons the check makes against them.

**Why it still matters.** The native module is the preferred path and TypeScript is only the fallback. The moment `fromDateTimeLocalValue` is wired into the main process, or the renderer is moved onto the native module, the panic surfaces on every reminder edit. These are defects in code that has no caller yet, not in code that is running.

## Coverage record

Sync commit: **`c7bb4798475e00cecc3b30957359aaded25d3cca`**. The verification was last confirmed to describe the code at that commit.

| file | functions compared |
| --- | --- |
| `src/shared/todo/weekRange.ts` | `getWeekRange`, `isInWeek`, `isInCurrentWeek`, `isTodoInWeek`, and `parseTodoTime` through `isInWeek` |
| `src/shared/todo/reminderTime.ts` | `dayDiff`, `formatReminderLabel`, `formatLocalDateTime`, `toDateTimeLocalValue`, `fromDateTimeLocalValue`, `resolveReminderTime` |
| `src/shared/todo/reminderDue.ts` | `pickDueReminders`, `isExpiredReminder` |
| `src/shared/todo/todo-rs/src/port.rs` | the Rust port of every function above |
| `src/shared/todo/todo-rs/index.cjs` | the JS bridge, including the wire decoder `rDyn` |

### Input domain

- 2026 whole year, hourly, plus every Monday boundary ±15 h at 5-minute steps.
- Four input shapes per instant: epoch number, epoch as string, ISO string, SQLite UTC string.
- Degenerate inputs: `null`, `undefined`, empty string, non-date text, `NaN`, `Infinity`.
- 36 local datetime strings: with and without seconds, with and without milliseconds, `T`-separated and space-separated.
- 59 natural-language reminder phrases (Chinese relative days, time-of-day words, weekdays, durations, absolute dates, and the English equivalents) across 5 reference instants.
- 7 reminder-candidate rows (past, exactly due, future, no reminder time, invalid reminder time, SQLite-format timestamp) across 3 grace windows.
- Time zones attempted: `Asia/Shanghai`, `America/New_York`, `UTC`, `Asia/Kolkata`, `Pacific/Chatham`.

## What it does not cover

- Anything outside 2026: other years, the 29 February of a leap year, dates before the epoch, and the year boundary itself.
- Time zones other than the system one, for the reason described above.
- `resolveReminderTime` inputs outside the 59 phrases — the phrase grammar is open-ended, so this check samples it rather than exhausting it.
- The `Date.parse` behaviour of the browser renderer versus `parse_js_date` in Rust for formats outside the 36 strings.
- The rest of `todo-rs`: `resolveReminderTime`'s internal branches, `pickDueReminders`' row-shape handling, and any function added to the crate later.
- The UI. That is the [verify-qnote](../verify-qnote/SKILL.md) skill's job: it drives the real app and proves the outcome on screen and in the database.

## Keeping it in step with the code

- When a change touches any file in the coverage table, run the check before and after.
- If the check starts failing after an **intended** change to the covered code, fix the implementation, not the checker. The property is the contract.
- If a change to the covered code is correct and the Rust side now agrees, update the "What it found" section above, then move the sync commit forward — but only after confirming the check describes the code **at the new commit**. Never move the sync commit to a commit you have not re-run the check against.
- If the change is to the checker itself (a wider domain, a new function), say so explicitly in the commit message; the domain *is* the property.
- Use `/maintain-formal-verification-skill` to bring this verification back in line after changes that did not recheck it.
