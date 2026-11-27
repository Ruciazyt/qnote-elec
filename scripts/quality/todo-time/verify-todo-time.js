const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveExe } = require("../../lib/resolve-exe");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WEEK_ENTRY = path.join(REPO_ROOT, "dist", "shared", "todo", "weekRange.js");
const REMINDER_ENTRY = path.join(REPO_ROOT, "dist", "shared", "todo", "reminderTime.js");
const DUE_ENTRY = path.join(REPO_ROOT, "dist", "shared", "todo", "reminderDue.js");
const RUST_ENTRY = path.join(REPO_ROOT, "dist", "native", "todo-rs.cjs");

const ZONES = ["Asia/Shanghai", "America/New_York", "UTC", "Asia/Kolkata", "Pacific/Chatham"];
const YEAR_START = Date.UTC(2026, 0, 1, 0, 0, 0);
const YEAR_END = Date.UTC(2027, 0, 1, 0, 0, 0);
const HOUR = 3600_000;
const MINUTE = 60_000;
const SHAPES = ["number", "number-string", "iso", "sqlite-utc"];
const DEGENERATE = ["null", "undefined", "empty", "invalid", "nan", "infinity"];
const MAX_REPORTED = 25;
const DAY = 24 * HOUR;

const NOW_INSTANTS = [
    Date.UTC(2026, 0, 1, 0, 0, 0),
    Date.UTC(2026, 2, 8, 2, 30, 0),
    Date.UTC(2026, 5, 15, 4, 30, 0),
    Date.UTC(2026, 10, 1, 16, 0, 0),
    Date.UTC(2026, 11, 30, 4, 30, 0),
];

const REMINDER_PHRASES = [
    "", "   ", "不是时间",
    "今天", "今日", "今早", "今晚", "今天下午", "今天 15:30", "今天晚上8点",
    "明天", "明日", "明早", "明晚", "明天上午9点", "明天 08:30",
    "后天", "大后天", "昨天", "前天",
    "凌晨3点", "清晨", "早晨", "早上八点", "上午", "中午12点", "下午3点半", "傍晚6点", "晚上8点", "夜里10点",
    "周一", "周三", "周五", "周日", "本周五", "下周一下午3点", "星期日", "礼拜二",
    "10分钟后", "2小时后", "3天后", "1周后", "五分钟后",
    "2026-12-30 10:00", "2026年12月30日", "12月30日", "30日",
    "today", "tomorrow", "tonight", "day after tomorrow", "today at 3pm", "tomorrow morning",
    "next monday", "this friday", "monday 9:00", "in 30 minutes", "in 2 hours", "in 3 days",
];

const GRACES = [0, 60_000, 3 * HOUR];

function pad(value, width = 2) {
    return String(value).padStart(width, "0");
}

function sqliteUtcString(ms) {
    const d = new Date(ms);
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
}

function shapeValue(shape, ms) {
    switch (shape) {
        case "number":
            return ms;
        case "number-string":
            return String(ms);
        case "iso":
            return new Date(ms).toISOString();
        case "sqlite-utc":
            return sqliteUtcString(ms);
        case "null":
            return null;
        case "undefined":
            return undefined;
        case "empty":
            return "";
        case "invalid":
            return "not-a-date";
        case "nan":
            return Number.NaN;
        case "infinity":
            return Number.POSITIVE_INFINITY;
        default:
            throw new Error(`未知的时间形状 ${shape}`);
    }
}

function localValueStrings() {
    const bases = ["2026-12-30T12:30", "2026-01-01T00:00", "2026-06-15T23:59", "2026-03-08T02:30"];
    const values = [];
    for (const base of bases) {
        values.push(base);
        values.push(`${base}:00`);
        values.push(`${base}:00.000`);
        values.push(`${base}:00.123`);
        values.push(`${base}:00.999`);
        values.push(`${base}:30.456`);
        values.push(base.replace("T", " "));
        values.push(`${base.replace("T", " ")}:00.123`);
        values.push(`${base.replace("T", " ")}:00`);
    }
    return values;
}

function jsLocalStamp(ms) {
    const d = new Date(ms);
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
}

function oracleWeekRange(now) {
    const back = (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 0, 0, 0, 0);
    const end = new Date(monday);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start: monday, end };
}

function mondayBoundaries() {
    const boundaries = [];
    for (let t = YEAR_START; t <= YEAR_END; t += 7 * 24 * HOUR) {
        const d = new Date(t);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
        boundaries.push(day.getTime());
    }
    return boundaries;
}

function enumerateInstants() {
    const instants = new Set();
    for (let t = YEAR_START; t <= YEAR_END; t += HOUR) instants.add(t);
    for (const boundary of mondayBoundaries()) {
        for (let t = boundary - 15 * HOUR; t <= boundary + 15 * HOUR; t += 5 * MINUTE) {
            instants.add(t);
        }
    }
    return [...instants].sort((a, b) => a - b);
}

function sameInstant(a, b) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.getTime() === b.getTime();
}

function instantOf(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value === "object" && typeof value.$date === "string") {
        const parsed = Date.parse(value.$date);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function resolutionOf(result) {
    if (!result || typeof result !== "object") return `bad:${String(result)}`;
    const at = result.at instanceof Date ? result.at.getTime() : instantOf(result.at);
    return `${result.ok ? "ok" : "no"}|${at === null || at === undefined ? "-" : at}`;
}

function errorOf(result) {
    if (!result || typeof result !== "object") return `bad:${String(result)}`;
    return result.error ?? "";
}

function candidateRows(nowMs) {
    const iso = (ms) => new Date(ms).toISOString();
    return [
        { id: 1, title: "十分钟前", notes: null, priority: "medium", remind_at: iso(nowMs - 10 * MINUTE) },
        { id: 2, title: "刚好到期", notes: null, priority: "medium", remind_at: iso(nowMs) },
        { id: 3, title: "两小时后", notes: null, priority: "low", remind_at: iso(nowMs + 2 * HOUR) },
        { id: 4, title: "没有提醒时间", notes: null, priority: "low", remind_at: null },
        { id: 5, title: "非法提醒时间", notes: null, priority: "low", remind_at: "not-a-date" },
        { id: 6, title: "三天前", notes: "带备注", priority: "high", remind_at: iso(nowMs - 3 * DAY) },
        { id: 7, title: "SQLite 格式", notes: null, priority: "medium", remind_at: sqliteUtcString(nowMs - 5 * MINUTE) },
    ];
}

function jsTypeOf(value) {
    if (value === null || value === undefined) return "null";
    if (value instanceof Date) return "date";
    if (Array.isArray(value)) return "array";
    return `object:${Object.prototype.toString.call(value)}`;
}

function errorText(error) {
    return String(error?.message ?? error)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" ")
        .slice(0, 220);
}

function runChild(zone) {
    const week = require(WEEK_ENTRY);
    const reminder = require(REMINDER_ENTRY);
    const due = require(DUE_ENTRY);
    const rust = require(RUST_ENTRY);

    const probe = Date.UTC(2026, 5, 15, 4, 30, 0);
    const jsStamp = jsLocalStamp(probe);
    let rustStamp = "";
    try {
        rustStamp = String(rust.formatLocalDateTime(new Date(probe))).replace(" ", "T");
    } catch (error) {
        return {
            zone,
            skipped: true,
            reason: `原生实现的 formatLocalDateTime 抛错：${errorText(error)}`,
            compared: 0,
            mismatchCount: 0,
            byKind: {},
            mismatches: [],
        };
    }
    if (jsStamp !== rustStamp) {
        return {
            zone,
            skipped: true,
            reason: `本进程里时区只对 JS 生效（JS ${jsStamp} / Rust ${rustStamp}），这一时区不比对`,
            compared: 0,
            mismatchCount: 0,
            byKind: {},
            mismatches: [],
        };
    }

    const mismatches = [];
    const byKind = {};
    const instants = enumerateInstants();
    let compared = 0;
    let totalMismatches = 0;

    const report = (kind, detail) => {
        totalMismatches += 1;
        byKind[kind] = (byKind[kind] ?? 0) + 1;
        if (mismatches.length < MAX_REPORTED) mismatches.push({ kind, zone, ...detail });
    };

    const check = (kind, tsFn, rustFn, detail) => {
        compared += 1;
        let rustValue;
        try {
            rustValue = rustFn();
        } catch (error) {
            let tsValue;
            try {
                tsValue = tsFn();
            } catch (tsError) {
                tsValue = `TS_ERROR:${errorText(tsError)}`;
            }
            report("rust-error", { ...detail, ts: tsValue, rust: `RUST_ERROR:${errorText(error)}` });
            return;
        }
        let tsValue;
        try {
            tsValue = tsFn();
        } catch (error) {
            report("ts-error", { ...detail, ts: `TS_ERROR:${errorText(error)}`, rust: rustValue });
            return;
        }
        if (tsValue !== rustValue) report(kind, { ...detail, ts: tsValue, rust: rustValue });
    };

    for (const shape of DEGENERATE) {
        const value = shapeValue(shape, 0);
        const now = new Date(probe);
        check(
            "degenerate-week",
            () => week.isInWeek(value, week.getWeekRange(now)),
            () => rust.isInWeek(value, rust.getWeekRange(now)),
            { shape }
        );
        check(
            "degenerate-current",
            () => week.isInCurrentWeek(value, now),
            () => rust.isInCurrentWeek(value, now),
            { shape }
        );
        const todo = { created_at: value, completed_at: null };
        check(
            "degenerate-todo",
            () => week.isTodoInWeek(todo, week.getWeekRange(now)),
            () => rust.isTodoInWeek(todo, rust.getWeekRange(now)),
            { shape }
        );
        check(
            "degenerate-local-value",
            () => instantOf(reminder.fromDateTimeLocalValue(String(value ?? ""))),
            () => instantOf(rust.fromDateTimeLocalValue(String(value ?? ""))),
            { shape }
        );
    }

    for (const text of localValueStrings()) {
        check(
            "from-local-shape",
            () => jsTypeOf(reminder.fromDateTimeLocalValue(text)),
            () => jsTypeOf(rust.fromDateTimeLocalValue(text)),
            { text }
        );
        check(
            "from-local-string",
            () => instantOf(reminder.fromDateTimeLocalValue(text)),
            () => instantOf(rust.fromDateTimeLocalValue(text)),
            { text }
        );
    }

    for (const nowMs of NOW_INSTANTS) {
        const now = new Date(nowMs);
        for (const phrase of REMINDER_PHRASES) {
            check(
                "resolve-reminder",
                () => resolutionOf(reminder.resolveReminderTime(phrase, now)),
                () => resolutionOf(rust.resolveReminderTime(phrase, now)),
                { phrase, now: now.toISOString() }
            );
            check(
                "resolve-reminder-error",
                () => errorOf(reminder.resolveReminderTime(phrase, now)),
                () => errorOf(rust.resolveReminderTime(phrase, now)),
                { phrase, now: now.toISOString() }
            );
        }
        for (const grace of GRACES) {
            for (const row of candidateRows(nowMs)) {
                check(
                    "expired-reminder",
                    () => due.isExpiredReminder(row, now, grace),
                    () => rust.isExpiredReminder(row, now, grace),
                    { id: row.id, grace, now: now.toISOString() }
                );
            }
            check(
                "pick-due",
                () => due.pickDueReminders(candidateRows(nowMs), now, grace).map((row) => row.id).join(","),
                () => rust.pickDueReminders(candidateRows(nowMs), now, grace).map((row) => row.id).join(","),
                { grace, now: now.toISOString() }
            );
        }
    }

    let shapeIndex = 0;
    for (const ms of instants) {
        const shape = SHAPES[shapeIndex % SHAPES.length];
        shapeIndex += 1;
        const value = shapeValue(shape, ms);
        const now = new Date(ms);

        let tsRange = null;
        let rustRange = null;
        compared += 1;
        try {
            tsRange = week.getWeekRange(now);
            rustRange = rust.getWeekRange(now);
        } catch (error) {
            report("range-error", { ms, shape, error: errorText(error) });
            continue;
        }
        if (!sameInstant(tsRange.start, rustRange.start) || !sameInstant(tsRange.end, rustRange.end)) {
            report("range", {
                ms,
                shape,
                ts: [tsRange.start.toISOString(), tsRange.end.toISOString()],
                rust: [rustRange.start.toISOString(), rustRange.end.toISOString()],
            });
            continue;
        }

        const oracle = oracleWeekRange(now);
        check(
            "oracle-range",
            () => `${oracle.start.getTime()}:${oracle.end.getTime()}`,
            () => `${tsRange.start.getTime()}:${tsRange.end.getTime()}`,
            { ms, shape }
        );

        const tsInWeek = week.isInWeek(value, tsRange);
        check("in-week", () => tsInWeek, () => rust.isInWeek(value, rustRange), { ms, shape });
        const expected = ms >= tsRange.start.getTime() && ms <= tsRange.end.getTime();
        check("in-week-oracle", () => tsInWeek, () => expected, {
            ms,
            shape,
            range: [tsRange.start.toISOString(), tsRange.end.toISOString()],
        });

        const todo = { created_at: value, completed_at: null };
        check(
            "todo-week",
            () => week.isTodoInWeek(todo, tsRange),
            () => rust.isTodoInWeek(todo, rustRange),
            { ms, shape }
        );

        check(
            "current-week",
            () => week.isInCurrentWeek(value, now),
            () => rust.isInCurrentWeek(value, now),
            { ms, shape }
        );

        check(
            "day-diff",
            () => reminder.dayDiff(new Date(ms), new Date(ms + 36 * HOUR)),
            () => rust.dayDiff(new Date(ms), new Date(ms + 36 * HOUR)),
            { ms }
        );
        check(
            "reminder-label",
            () => reminder.formatReminderLabel(new Date(ms), now),
            () => rust.formatReminderLabel(new Date(ms), now),
            { ms }
        );
        check(
            "local-stamp",
            () => reminder.formatLocalDateTime(new Date(ms)),
            () => rust.formatLocalDateTime(new Date(ms)),
            { ms }
        );
        check(
            "local-value",
            () => reminder.toDateTimeLocalValue(new Date(ms)),
            () => rust.toDateTimeLocalValue(new Date(ms)),
            { ms }
        );
        check(
            "from-local-value",
            () => instantOf(reminder.fromDateTimeLocalValue(reminder.toDateTimeLocalValue(new Date(ms)))),
            () => instantOf(rust.fromDateTimeLocalValue(rust.toDateTimeLocalValue(new Date(ms)))),
            { ms }
        );
    }

    return { zone, skipped: false, compared, mismatchCount: totalMismatches, byKind, mismatches };
}

function staleBuild() {
    const sources = [
        path.join(REPO_ROOT, "src", "shared", "todo", "weekRange.ts"),
        path.join(REPO_ROOT, "src", "shared", "todo", "reminderTime.ts"),
        path.join(REPO_ROOT, "src", "shared", "todo", "reminderDue.ts"),
    ];
    const compiled = path.join(REPO_ROOT, "dist", "shared", "todo", "weekRange.js");
    if (!fs.existsSync(compiled)) return "dist/shared/todo/weekRange.js 不存在";
    const compiledAt = fs.statSync(compiled).mtimeMs;
    for (const source of sources) {
        if (!fs.existsSync(source)) continue;
        if (fs.statSync(source).mtimeMs > compiledAt) {
            return `${path.relative(REPO_ROOT, source)} 比编译产物新，先跑 pnpm run build:electron`;
        }
    }
    return null;
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes("--child")) {
        const zoneIndex = args.indexOf("--zone");
        const zone = zoneIndex >= 0 ? args[zoneIndex + 1] : "UTC";
        const result = runChild(zone);
        process.stdout.write(JSON.stringify(result));
        process.exitCode = result.mismatchCount > 0 ? 1 : 0;
        return;
    }

    for (const required of [WEEK_ENTRY, REMINDER_ENTRY, DUE_ENTRY, RUST_ENTRY]) {
        if (!fs.existsSync(required)) {
            process.stderr.write(
                `${path.relative(REPO_ROOT, required)} 不存在，先跑 pnpm run build:electron 与 pnpm run build:rust` +
                    "（没有 cargo 时原生实现无法比对，这个检查会直接退出）\n"
            );
            process.exitCode = 1;
            return;
        }
    }

    const stale = staleBuild();
    if (stale) {
        process.stderr.write(`编译产物落后于源码：${stale}\n`);
        process.exitCode = 1;
        return;
    }

    let compared = 0;
    let failures = 0;
    let skipped = 0;
    const details = [];
    for (const zone of ZONES) {
        const child = spawnSync(resolveExe("node"), [__filename, "--child", "--zone", zone], {
            cwd: REPO_ROOT,
            env: { ...process.env, TZ: zone },
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
        let result;
        try {
            result = JSON.parse(child.stdout);
        } catch {
            process.stderr.write(
                `时区 ${zone} 的检查没跑完，进程可能崩了：\n${(child.stderr || "").slice(0, 1200)}\n`
            );
            failures += 1;
            continue;
        }
        if (result.skipped) {
            skipped += 1;
            process.stdout.write(`${zone}: 跳过 —— ${result.reason}\n`);
            continue;
        }
        compared += result.compared;
        if (result.mismatchCount > 0) {
            failures += 1;
            details.push(result);
        }
        const breakdown = Object.entries(result.byKind ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => `${kind} ${count}`)
            .join("、");
        process.stdout.write(
            `${zone}: 比较 ${result.compared} 项，不一致 ${result.mismatchCount} 项` +
                (breakdown ? `（${breakdown}）` : "") +
                "\n"
        );
    }

    process.stdout.write(`\n合计比较 ${compared} 项，跳过 ${skipped} 个时区\n`);
    if (failures > 0) {
        process.stdout.write(JSON.stringify(details, null, 2) + "\n");
        process.stderr.write("有时区没过：Rust 原生实现与 TS 实现对同一个输入给出了不同的答案\n");
        process.exitCode = 1;
        return;
    }
    process.stdout.write("全部有效时区一致：Rust 原生实现与 TS 实现在每个枚举输入上给出同样的答案\n");
}

main();
