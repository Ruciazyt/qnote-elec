//! The Rust port of src/shared/todo/.

#![forbid(unsafe_code)]

use std::sync::LazyLock;

use chrono::{
    Datelike, Local, LocalResult, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Timelike,
};
use regex::Regex;
use serde_json::{Value, json};

use crate::js;
use crate::utf16;

const MINUTE_MS: f64 = 60_000.0;
const HOUR_MS: f64 = 3_600_000.0;
const DAY_MS: f64 = 86_400_000.0;
const DEFAULT_HOUR: u32 = 9;
const LEGACY_DEFAULT_YEAR: i64 = 2001;
/// The largest epoch a JS Date can hold.
const MAX_TIME_MS: f64 = 8.64e15;

/// JS \s 的字符集合。Rust 的 \s 是 Unicode White_Space：多了 U+0085、少了 U+FEFF。
const JS_SPACE: &str = r"[\t\n\x0B\x0C\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

/// JS 的 i 标志只按 ASCII 折叠大小写，Rust 的 (?i) 走 Unicode 折叠。
/// JS 的 \b 和 \d 只认 ASCII，Rust 的在 Unicode 模式下认更多。
fn expand(pattern: &str) -> String {
    pattern
        .replace("~s~", "(?-i:[sS])")
        .replace("~k~", "(?-i:[kK])")
        .replace("~az~", "(?-i:[a-zA-Z])")
        .replace("~ws~", JS_SPACE)
}

fn regex(pattern: &str) -> Regex {
    Regex::new(&expand(pattern)).expect("pattern compiles")
}

static JS_SPACE_RE: LazyLock<Regex> = LazyLock::new(|| regex(r"~ws~+"));

static SQLITE_DATETIME: LazyLock<Regex> =
    LazyLock::new(|| regex(r"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$"));

static EPOCH_MILLIS: LazyLock<Regex> = LazyLock::new(|| regex(r"^[0-9]{12,}$"));

static ISO_DATE: LazyLock<Regex> = LazyLock::new(|| regex(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$"));

static ISO_DATE_TIME: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$",
    )
});

static YEAR_MONTH: LazyLock<Regex> = LazyLock::new(|| regex(r"^([0-9]{4})-([0-9]{1,2})$"));

static YEAR_ONLY: LazyLock<Regex> = LazyLock::new(|| regex(r"^([0-9]{4})$"));

static CLOCK_COLON: LazyLock<Regex> =
    LazyLock::new(|| regex(r"([0-9]{1,2})~ws~?[:：]~ws~?([0-9]{1,2})"));

static DIGITS_ONLY: LazyLock<Regex> = LazyLock::new(|| regex(r"^[0-9]+$"));

static ABSOLUTE_ISO: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:?[0-9]{2})$")
});

static FULL_DATE: LazyLock<Regex> =
    LazyLock::new(|| regex(r"^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$"));

static SHORT_DATE: LazyLock<Regex> = LazyLock::new(|| regex(r"^([0-9]{1,2})-([0-9]{1,2})$"));

static CLOCK_PART: LazyLock<Regex> =
    LazyLock::new(|| regex(r"^([0-9]{1,2})[:：]([0-9]{1,2})(?::([0-9]{1,2}))?$"));

static HALF_HOUR: LazyLock<Regex> =
    LazyLock::new(|| regex(r"半(?:个)?~ws~*(小时|钟头)(?:后|以后|之后)"));

static EN_DURATION: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"(?i)(?-u:\b)in~ws~+([0-9]+)~ws~*(minute|min|hour|hr|day|wee~k~)(?-i:[sS])?")
});

static CN_WEEKDAY: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(下|本|这|下个|这个)?(?:周|星期|礼拜)([一二三四五六日天])"));

static EN_WEEKDAY: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)(?-u:\b)(next|thi~s~|coming)?~ws~*(monday|tue~s~day|wednes~s~day|thur~s~day|friday|saturday|~s~unday)(?-u:\b)",
    )
});

static EN_MERIDIEM: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)([0-9]{1,2})(?::([0-9]{2}))?~ws~*(am|pm)(?-u:\b)"));

static EN_PLAIN_CLOCK: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?-u:\b)([0-9]{1,2}):([0-9]{2})(?-u:\b)"));

static EN_DAY_AFTER_TOMORROW: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?-u:\b)day after tomorrow(?-u:\b)"));

static EN_TOMORROW: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)tomorrow(?-u:\b)"));

static EN_TONIGHT: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)tonight(?-u:\b)"));

static EN_TODAY: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)today(?-u:\b)"));

static EN_MORNING: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)morning(?-u:\b)"));

static EN_AFTERNOON: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)afternoon(?-u:\b)"));

static EN_EVENING: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)evening(?-u:\b)"));

static EN_NIGHT: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)night(?-u:\b)"));

static EN_NOON: LazyLock<Regex> = LazyLock::new(|| regex(r"(?-u:\b)noon(?-u:\b)"));

static MONTH_ABBREVIATIONS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

static CN_DURATION_UNITS: [&str; 9] = [
    "分钟", "分", "小时", "钟头", "天", "日", "周", "星期", "礼拜",
];

static CN_DURATION_SUFFIXES: [&str; 3] = ["以后", "之后", "后"];

static PERIOD_DEFAULT_HOUR: [(&str, u32); 10] = [
    ("凌晨", 3),
    ("清晨", 6),
    ("早晨", 8),
    ("早上", 8),
    ("上午", 9),
    ("中午", 12),
    ("下午", 14),
    ("傍晚", 18),
    ("晚上", 20),
    ("夜里", 21),
];

static PERIOD_WORDS: [&str; 10] = [
    "凌晨", "清晨", "早晨", "早上", "上午", "中午", "下午", "傍晚", "晚上", "夜里",
];

static PM_PERIODS: [&str; 4] = ["下午", "傍晚", "晚上", "夜里"];

struct DayWord {
    word: &'static str,
    offset: i64,
    period: Option<&'static str>,
}

static DAY_WORDS: [DayWord; 12] = [
    DayWord {
        word: "大后天",
        offset: 3,
        period: None,
    },
    DayWord {
        word: "后天",
        offset: 2,
        period: None,
    },
    DayWord {
        word: "明早",
        offset: 1,
        period: Some("早上"),
    },
    DayWord {
        word: "明晚",
        offset: 1,
        period: Some("晚上"),
    },
    DayWord {
        word: "明天",
        offset: 1,
        period: None,
    },
    DayWord {
        word: "明日",
        offset: 1,
        period: None,
    },
    DayWord {
        word: "今天",
        offset: 0,
        period: None,
    },
    DayWord {
        word: "今日",
        offset: 0,
        period: None,
    },
    DayWord {
        word: "今晚",
        offset: 0,
        period: Some("晚上"),
    },
    DayWord {
        word: "今早",
        offset: 0,
        period: Some("早上"),
    },
    DayWord {
        word: "昨天",
        offset: -1,
        period: None,
    },
    DayWord {
        word: "前天",
        offset: -2,
        period: None,
    },
];

/// A Date argument: the epoch it stands for, and whether it really is a Date.
struct NowArg {
    millis: f64,
    is_date: bool,
}

fn cn_weekday(word: &str) -> Option<i64> {
    Some(match word {
        "一" => 1,
        "二" => 2,
        "三" => 3,
        "四" => 4,
        "五" => 5,
        "六" => 6,
        "日" => 7,
        "天" => 7,
        _ => return None,
    })
}

fn en_weekday(word: &str) -> Option<i64> {
    Some(match word.to_ascii_lowercase().as_str() {
        "monday" => 1,
        "tuesday" => 2,
        "wednesday" => 3,
        "thursday" => 4,
        "friday" => 5,
        "saturday" => 6,
        "sunday" => 7,
        _ => return None,
    })
}

fn cn_digit(ch: char) -> Option<i64> {
    Some(match ch {
        '零' | '〇' => 0,
        '一' => 1,
        '二' => 2,
        '两' => 2,
        '三' => 3,
        '四' => 4,
        '五' => 5,
        '六' => 6,
        '七' => 7,
        '八' => 8,
        '九' => 9,
        _ => return None,
    })
}

/// JS String.prototype.trim: WhiteSpace and LineTerminator, not Rust's White_Space set.
fn js_trim(s: &str) -> String {
    s.trim_matches(is_js_whitespace).to_string()
}

fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{A}'
            | '\u{B}'
            | '\u{C}'
            | '\u{D}'
            | '\u{20}'
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn remove_whitespace(text: &str) -> String {
    JS_SPACE_RE.replace_all(text, "").into_owned()
}

fn pad2(value: u32) -> String {
    if value < 10 {
        format!("0{value}")
    } else {
        value.to_string()
    }
}

/// JS Math.round: halves go towards +Infinity.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A JS number that crossed the JSON channel as a marker.
fn marker_number(value: &Value) -> Option<f64> {
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    let raw = object.get("$num")?.as_str()?;
    Some(match raw {
        "NaN" => f64::NAN,
        "Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        "-0" => -0.0,
        other => other.parse().ok()?,
    })
}

/// The epoch milliseconds of a Date that crossed the JSON channel.
fn date_millis(value: &Value) -> Option<f64> {
    let raw = value.as_object()?.get("$date")?.as_str()?;
    if raw == "Invalid" {
        return Some(f64::NAN);
    }
    parse_rfc3339_millis(raw)
}

fn parse_rfc3339_millis(text: &str) -> Option<f64> {
    let dt = chrono::DateTime::parse_from_rfc3339(text).ok()?;
    Some(dt.timestamp_millis() as f64)
}

/// The epoch milliseconds a Date argument carries, or the error JS would throw.
fn require_date_prop(value: &Value, var_name: &str, prop: &str) -> Result<f64, String> {
    if value.is_null() {
        return Err(format!(
            "TypeError: Cannot read properties of null (reading '{prop}')"
        ));
    }
    if js::is_undefined(value) {
        return Err(format!(
            "TypeError: Cannot read properties of undefined (reading '{prop}')"
        ));
    }
    match date_millis(value) {
        Some(ms) => Ok(ms),
        None => Err(format!("TypeError: {var_name}.{prop} is not a function")),
    }
}

fn now_arg(value: &Value) -> NowArg {
    if js::is_undefined(value) {
        return NowArg {
            millis: now_millis(),
            is_date: true,
        };
    }
    match date_millis(value) {
        Some(ms) => NowArg {
            millis: ms,
            is_date: true,
        },
        None => NowArg {
            millis: f64::NAN,
            is_date: false,
        },
    }
}

fn now_millis() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(f64::NAN)
}

fn local_datetime(ms: f64) -> Option<NaiveDateTime> {
    if !ms.is_finite() {
        return None;
    }
    Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|dt| dt.naive_local())
}

fn get_full_year(ms: f64) -> i32 {
    local_datetime(ms).map_or(0, |dt| dt.year())
}

fn get_month(ms: f64) -> i32 {
    local_datetime(ms).map_or(0, |dt| dt.month() as i32 - 1)
}

fn get_date(ms: f64) -> u32 {
    local_datetime(ms).map_or(0, |dt| dt.day())
}

fn get_hours(ms: f64) -> u32 {
    local_datetime(ms).map_or(0, |dt| dt.hour())
}

fn get_minutes(ms: f64) -> u32 {
    local_datetime(ms).map_or(0, |dt| dt.minute())
}

/// JS Date.getDay: Sunday is 0.
fn get_day(ms: f64) -> u32 {
    local_datetime(ms).map_or(0, |dt| (dt.weekday().num_days_from_monday() + 1) % 7)
}

/// JS new Date(year, month, day, hour, minute, second) in local time.
fn local_epoch(year: i32, month0: i32, day: i64, hour: i64, minute: i64, second: i64) -> f64 {
    let Some(base) = NaiveDate::from_ymd_opt(year, (month0 + 1) as u32, 1) else {
        return f64::NAN;
    };
    let Some(date) = base.checked_add_signed(chrono::Duration::days(day - 1)) else {
        return f64::NAN;
    };
    let Some(naive) = date
        .and_hms_opt(0, 0, 0)
        .and_then(|value| value.checked_add_signed(chrono::Duration::hours(hour)))
        .and_then(|value| value.checked_add_signed(chrono::Duration::minutes(minute)))
        .and_then(|value| value.checked_add_signed(chrono::Duration::seconds(second)))
    else {
        return f64::NAN;
    };
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt.timestamp_millis() as f64,
        LocalResult::Ambiguous(first, _) => first.timestamp_millis() as f64,
        LocalResult::None => {
            let offset = Local.offset_from_utc_datetime(&naive);
            (naive - offset).and_utc().timestamp_millis() as f64
        }
    }
}

/// JS new Date(year, month, day, hour, minute, second) in UTC.
fn utc_epoch(year: i32, month0: i32, day: i64, hour: i64, minute: i64, second: i64) -> f64 {
    let Some(base) = NaiveDate::from_ymd_opt(year, (month0 + 1) as u32, 1) else {
        return f64::NAN;
    };
    let Some(date) = base.checked_add_signed(chrono::Duration::days(day - 1)) else {
        return f64::NAN;
    };
    let Some(naive) = date
        .and_hms_opt(0, 0, 0)
        .and_then(|value| value.checked_add_signed(chrono::Duration::hours(hour)))
        .and_then(|value| value.checked_add_signed(chrono::Duration::minutes(minute)))
        .and_then(|value| value.checked_add_signed(chrono::Duration::seconds(second)))
    else {
        return f64::NAN;
    };
    naive.and_utc().timestamp_millis() as f64
}

fn start_of_day(ms: f64) -> f64 {
    if !ms.is_finite() {
        return f64::NAN;
    }
    local_epoch(
        get_full_year(ms),
        get_month(ms),
        i64::from(get_date(ms)),
        0,
        0,
        0,
    )
}

fn shift_days(ms: f64, days: i64) -> f64 {
    if !ms.is_finite() {
        return f64::NAN;
    }
    local_epoch(
        get_full_year(ms),
        get_month(ms),
        i64::from(get_date(ms)) + days,
        0,
        0,
        0,
    )
}

fn at_time(base: f64, hour: u32, minute: u32, second: u32) -> f64 {
    local_epoch(
        get_full_year(base),
        get_month(base),
        i64::from(get_date(base)),
        i64::from(hour),
        i64::from(minute),
        i64::from(second),
    )
}

/// The month a month name prefix stands for, the way V8's fallback parser finds it.
fn month_prefix(lower: &str) -> Option<u32> {
    let key = lower.get(..3)?;
    MONTH_ABBREVIATIONS
        .iter()
        .position(|m| *m == key)
        .map(|i| u32::try_from(i).unwrap_or(0) + 1)
}

/// The year a two-digit number stands for, the way V8 reads it.
fn legacy_year(value: i64) -> i64 {
    if (0..50).contains(&value) {
        value + 2000
    } else if (50..100).contains(&value) {
        value + 1900
    } else {
        value
    }
}

/// The characters V8's fallback parser treats as word separators.
fn is_legacy_separator(ch: char) -> bool {
    matches!(
        ch,
        ',' | '-'
            | '.'
            | '/'
            | ';'
            | '!'
            | '@'
            | '#'
            | '$'
            | '%'
            | '&'
            | '*'
            | '='
            | '?'
            | '<'
            | '>'
            | '\''
            | '"'
    )
}

/// The whitespace JS \s matches.
fn is_js_space_char(ch: char) -> bool {
    matches!(
        ch,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// The weekday names V8 accepts as the first word of a date string.
static WEEKDAY_ABBREVIATIONS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/// The pieces V8's fallback parser reads out of a date string.
struct LegacyScan {
    numbers: Vec<i64>,
    month_name: Option<u32>,
    time: Option<(i64, i64, i64, i64)>,
    offset_minutes: Option<i64>,
    utc: bool,
    meridiem: Option<bool>,
}

/// The time a "HH:MM[:SS[.mmm]]" stands for, and where it ends.
fn scan_legacy_time(
    chars: &[char],
    mut cursor: usize,
    hour: i64,
) -> Option<(i64, i64, i64, i64, usize)> {
    if !(0..=99).contains(&hour) {
        return None;
    }
    let minute_start = cursor;
    while cursor < chars.len() && chars[cursor].is_ascii_digit() {
        cursor += 1;
    }
    let minute_digits: String = chars[minute_start..cursor].iter().collect();
    if minute_digits.is_empty() || minute_digits.len() > 2 {
        return None;
    }
    let minute: i64 = minute_digits.parse().ok()?;
    let mut second = 0i64;
    let mut millis = 0i64;
    if cursor < chars.len() && chars[cursor] == ':' {
        cursor += 1;
        let second_start = cursor;
        while cursor < chars.len() && chars[cursor].is_ascii_digit() {
            cursor += 1;
        }
        let second_digits: String = chars[second_start..cursor].iter().collect();
        if second_digits.is_empty() || second_digits.len() > 2 {
            return None;
        }
        second = second_digits.parse().ok()?;
        if cursor < chars.len() && chars[cursor] == '.' {
            cursor += 1;
            let fraction_start = cursor;
            while cursor < chars.len() && chars[cursor].is_ascii_digit() {
                cursor += 1;
            }
            let fraction: String = chars[fraction_start..cursor].iter().collect();
            let mut value = 0i64;
            for ch in fraction.chars().take(3) {
                value = value * 10 + i64::from(ch.to_digit(10).unwrap_or(0));
            }
            millis = value;
        }
    }
    Some((hour, minute, second, millis, cursor))
}

/// Reads the pieces of a date string the way V8's fallback parser does.
fn scan_legacy(text: &str) -> Option<LegacyScan> {
    let chars: Vec<char> = text.chars().collect();
    let mut scan = LegacyScan {
        numbers: Vec::new(),
        month_name: None,
        time: None,
        offset_minutes: None,
        utc: false,
        meridiem: None,
    };
    let mut cursor = 0usize;
    let mut words = 0usize;
    let mut seen_number = false;

    while cursor < chars.len() {
        let ch = chars[cursor];
        if is_js_space_char(ch) || is_legacy_separator(ch) {
            cursor += 1;
            continue;
        }
        if ch == '(' {
            cursor += 1;
            while cursor < chars.len() && chars[cursor] != ')' {
                cursor += 1;
            }
            if cursor < chars.len() {
                cursor += 1;
            }
            continue;
        }
        if (ch == '+' || ch == '-')
            && cursor + 1 < chars.len()
            && chars[cursor + 1].is_ascii_digit()
        {
            let attached = cursor > 0
                && !is_js_space_char(chars[cursor - 1])
                && chars[cursor - 1] != '+'
                && chars[cursor - 1] != '-';
            if !attached && (seen_number || scan.time.is_some()) {
                let sign = if ch == '+' { 1 } else { -1 };
                let mut end = cursor + 1;
                while end < chars.len() && chars[end].is_ascii_digit() {
                    end += 1;
                }
                let digits: String = chars[cursor + 1..end].iter().collect();
                let hours: i64 = if digits.len() > 2 {
                    digits[..2].parse().ok()?
                } else {
                    digits.parse().ok()?
                };
                let mut minutes: i64 = if digits.len() > 2 {
                    digits[2..].parse().ok()?
                } else {
                    0
                };
                if end + 1 < chars.len() && chars[end] == ':' && chars[end + 1].is_ascii_digit() {
                    let mut minute_end = end + 1;
                    while minute_end < chars.len() && chars[minute_end].is_ascii_digit() {
                        minute_end += 1;
                    }
                    let text: String = chars[end + 1..minute_end].iter().collect();
                    minutes = text.parse().ok()?;
                    end = minute_end;
                }
                scan.offset_minutes = Some(sign * (hours * 60 + minutes));
                cursor = end;
                words += 1;
                continue;
            }
            cursor += 1;
            continue;
        }
        if ch == ':' {
            cursor += 1;
            continue;
        }
        if ch.is_ascii_digit() {
            let start = cursor;
            while cursor < chars.len() && chars[cursor].is_ascii_digit() {
                cursor += 1;
            }
            let digits: String = chars[start..cursor].iter().collect();
            if cursor < chars.len() && chars[cursor] == ':' {
                let hour = digits.parse::<i64>().ok()?;
                let (hour, minute, second, millis, next) =
                    scan_legacy_time(&chars, cursor + 1, hour)?;
                scan.time = Some((hour, minute, second, millis));
                cursor = next;
                if cursor < chars.len() && (chars[cursor] == 'Z' || chars[cursor] == 'z') {
                    scan.utc = true;
                    cursor += 1;
                }
                words += 1;
                continue;
            }
            scan.numbers.push(digits.parse::<i64>().ok()?);
            seen_number = true;
            if cursor < chars.len()
                && !is_js_space_char(chars[cursor])
                && !is_legacy_separator(chars[cursor])
                && chars[cursor] != '('
                && chars[cursor] != ':'
            {
                let rest_start = cursor;
                while cursor < chars.len()
                    && !is_js_space_char(chars[cursor])
                    && !is_legacy_separator(chars[cursor])
                    && chars[cursor] != '('
                    && chars[cursor] != ':'
                {
                    cursor += 1;
                }
                let rest: String = chars[rest_start..cursor].iter().collect();
                let lower = rest.to_ascii_lowercase();
                if let Some(month) = month_prefix(&lower) {
                    scan.month_name = Some(month);
                    cursor = rest_start + 3;
                } else if lower == "utc" || lower == "gmt" || lower == "z" {
                    scan.utc = true;
                } else if lower == "am" || lower == "pm" {
                    scan.meridiem = Some(lower == "pm");
                } else {
                    return None;
                }
            }
            words += 1;
            continue;
        }

        let start = cursor;
        while cursor < chars.len()
            && !is_js_space_char(chars[cursor])
            && !is_legacy_separator(chars[cursor])
            && chars[cursor] != '('
            && chars[cursor] != ':'
        {
            cursor += 1;
        }
        let word: String = chars[start..cursor].iter().collect();
        let lower = word.to_ascii_lowercase();
        if let Some(month) = month_prefix(&lower) {
            scan.month_name = Some(month);
            cursor = start + 3;
            words += 1;
            continue;
        }
        if words == 0
            && let Some(key) = lower.get(..3)
            && WEEKDAY_ABBREVIATIONS.contains(&key)
        {
            cursor = start + 3;
            words += 1;
            continue;
        }
        if lower == "am" || lower == "pm" {
            scan.meridiem = Some(lower == "pm");
            words += 1;
            continue;
        }
        if lower == "utc" || lower == "gmt" || lower == "z" {
            scan.utc = true;
            words += 1;
            continue;
        }
        if seen_number {
            return None;
        }
        words += 1;
    }
    Some(scan)
}

/// JS new Date(string) for the strings V8's fallback parser accepts.
fn parse_legacy_date(text: &str) -> Option<f64> {
    let scan = scan_legacy(text)?;
    if scan.numbers.is_empty() {
        return None;
    }
    let named = scan.month_name.is_some();
    let mut month = scan.month_name.map(i64::from);
    let mut day: Option<i64> = None;
    let mut year: Option<i64> = None;
    let mut first = true;
    for number in scan.numbers {
        if named {
            if number == 0 || number >= 32 {
                if year.is_none() {
                    year = Some(legacy_year(number));
                }
            } else if day.is_none() {
                day = Some(number);
            } else if year.is_none() {
                year = Some(legacy_year(number));
            }
        } else if first {
            if (1..=31).contains(&number) {
                month = Some(number);
            } else {
                year = Some(legacy_year(number));
            }
        } else if month.is_none() {
            month = Some(number);
        } else if day.is_none() {
            day = Some(number);
        } else if year.is_none() {
            year = Some(legacy_year(number));
        } else {
            return None;
        }
        first = false;
    }

    let month = month.unwrap_or(1);
    let day = day.unwrap_or(1);
    let year = year.unwrap_or(LEGACY_DEFAULT_YEAR);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if scan.offset_minutes.is_some() && scan.time.is_none() {
        return None;
    }
    let year = i32::try_from(year).unwrap_or(i32::MAX);

    let (hour, minute, second, millis) = scan.time.unwrap_or((0, 0, 0, 0));
    let mut hour = hour;
    if let Some(pm) = scan.meridiem {
        if pm && hour < 12 {
            hour += 12;
        }
        if !pm && hour == 12 {
            hour = 0;
        }
    }
    let month0 = month as i32 - 1;
    let base = if scan.utc || scan.offset_minutes.is_some() {
        utc_epoch(year, month0, day, hour, minute, second)
    } else {
        local_epoch(year, month0, day, hour, minute, second)
    };
    if base.is_nan() {
        return None;
    }
    let mut millis = base + millis as f64;
    if let Some(offset) = scan.offset_minutes {
        millis -= offset as f64 * MINUTE_MS;
    }
    Some(millis)
}

/// JS new Date(string): the ISO forms plus the fallback forms V8 accepts.
fn parse_js_date(text: &str) -> f64 {
    if let Some(caps) = ISO_DATE.captures(text) {
        let year = caps[1].parse::<i32>().unwrap_or(0);
        let month = caps[2].parse::<u32>().unwrap_or(1);
        let day = caps[3].parse::<u32>().unwrap_or(1);
        return match NaiveDate::from_ymd_opt(year, month, day) {
            Some(date) => date
                .and_hms_opt(0, 0, 0)
                .map_or(f64::NAN, |naive| naive.and_utc().timestamp_millis() as f64),
            None => f64::NAN,
        };
    }

    if let Some(caps) = ISO_DATE_TIME.captures(text) {
        let year = caps[1].parse::<i32>().unwrap_or(0);
        let month = caps[2].parse::<u32>().unwrap_or(1);
        let day = caps[3].parse::<u32>().unwrap_or(1);
        let hour = caps[4].parse::<u32>().unwrap_or(0);
        let minute = caps[5].parse::<u32>().unwrap_or(0);
        let second = caps[6].parse::<u32>().unwrap_or(0);
        let millis = caps.get(7).map_or(0f64, |raw| {
            let mut value = 0f64;
            for ch in raw.as_str().chars().take(3) {
                value = value * 10.0 + f64::from(ch.to_digit(10).unwrap_or(0));
            }
            value
        });
        let offset = caps.get(8).map_or("", |m| m.as_str());
        let Some(date) = NaiveDate::from_ymd_opt(year, month, day) else {
            return f64::NAN;
        };
        let Some(naive) = date.and_hms_opt(hour, minute, second) else {
            return f64::NAN;
        };
        if offset.is_empty() {
            return local_epoch(
                year,
                month as i32 - 1,
                i64::from(day),
                i64::from(hour),
                i64::from(minute),
                i64::from(second),
            );
        }
        if offset == "Z" {
            return naive.and_utc().timestamp_millis() as f64 + millis;
        }
        let sign: i64 = if offset.starts_with('-') { -1 } else { 1 };
        let digits = &offset[1..];
        let (hours, minutes) = if let Some((h, m)) = digits.split_once(':') {
            (h, m)
        } else if digits.len() == 4 {
            (&digits[0..2], &digits[2..4])
        } else {
            return f64::NAN;
        };
        let Ok(hours) = hours.parse::<i64>() else {
            return f64::NAN;
        };
        let Ok(minutes) = minutes.parse::<i64>() else {
            return f64::NAN;
        };
        let total = hours * 60 + minutes;
        return naive.and_utc().timestamp_millis() as f64 - (sign * total) as f64 * 60_000.0
            + millis;
    }

    if let Some(caps) = YEAR_MONTH.captures(text) {
        let year = caps[1].parse::<i32>().unwrap_or(0);
        let month = caps[2].parse::<i32>().unwrap_or(1);
        return local_epoch(year, month - 1, 1, 0, 0, 0);
    }

    if let Some(caps) = YEAR_ONLY.captures(text) {
        let year = caps[1].parse::<i32>().unwrap_or(0);
        return local_epoch(year, 0, 1, 0, 0, 0);
    }

    parse_legacy_date(text).unwrap_or(f64::NAN)
}

/// The Date a value stands for, the way parseTodoTime reads it.
fn parse_todo_time(value: &Value) -> Result<Option<f64>, String> {
    if value.is_null() || js::is_undefined(value) {
        return Ok(None);
    }
    if let Some(ms) = date_millis(value) {
        return Ok(if ms.is_nan() { None } else { Some(ms) });
    }
    if let Some(ms) = marker_number(value) {
        if !ms.is_finite() || ms.abs() > MAX_TIME_MS {
            return Ok(None);
        }
        return Ok(Some(ms));
    }
    if let Value::Number(number) = value {
        let ms = number.as_f64().unwrap_or(f64::NAN);
        if !ms.is_finite() || ms.abs() > MAX_TIME_MS {
            return Ok(None);
        }
        return Ok(Some(ms));
    }
    let Value::String(text) = value else {
        return Err("TypeError: value.trim is not a function".to_string());
    };
    let trimmed = js_trim(text);
    if trimmed.is_empty() {
        return Ok(None);
    }
    if EPOCH_MILLIS.is_match(&trimmed) {
        let ms = trimmed.parse::<f64>().unwrap_or(f64::NAN);
        return Ok(if ms.is_nan() || ms.abs() > MAX_TIME_MS {
            None
        } else {
            Some(ms)
        });
    }
    let normalized = if SQLITE_DATETIME.is_match(&trimmed) {
        format!("{}T{}Z", &trimmed[..10], &trimmed[11..])
    } else {
        trimmed
    };
    let ms = parse_js_date(&normalized);
    Ok(if ms.is_nan() { None } else { Some(ms) })
}

fn take_trailing_number(text: &str) -> String {
    let units = utf16::units(text);
    let mut start = units.len();
    while start > 0 {
        let ch = char::from_u32(u32::from(units[start - 1]));
        let keep = match ch {
            Some(ch) => ch.is_ascii_digit() || cn_digit(ch).is_some(),
            None => false,
        };
        if !keep {
            break;
        }
        start -= 1;
    }
    utf16::slice(&units, start, units.len())
}

fn parse_chinese_number(raw: &str) -> Option<f64> {
    if raw.is_empty() {
        return None;
    }
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() == 1 {
        return cn_digit(chars[0]).map(|value| value as f64);
    }
    if let Some(pos) = chars.iter().position(|ch| *ch == '十') {
        let tens = if pos == 0 {
            1.0
        } else {
            cn_digit(chars[pos - 1])? as f64
        };
        let ones = if pos == chars.len() - 1 {
            0.0
        } else {
            cn_digit(chars[pos + 1])? as f64
        };
        return Some(tens * 10.0 + ones);
    }
    let mut value = 0f64;
    for ch in &chars {
        value = value * 10.0 + cn_digit(*ch)? as f64;
    }
    Some(value)
}

fn parse_clock_number(raw: &str) -> Option<f64> {
    if DIGITS_ONLY.is_match(raw) {
        return raw.parse::<f64>().ok();
    }
    parse_chinese_number(raw)
}

fn is_valid_clock(hour: f64, minute: f64) -> bool {
    (0.0..=23.0).contains(&hour) && (0.0..=59.0).contains(&minute)
}

fn extract_clock(text: &str) -> Option<(u32, u32)> {
    if let Some(caps) = CLOCK_COLON.captures(text) {
        let hour = caps[1].parse::<f64>().ok()?;
        let minute = caps[2].parse::<f64>().ok()?;
        if !is_valid_clock(hour, minute) {
            return None;
        }
        return Some((hour as u32, minute as u32));
    }

    let marker = text.find(['点', '时'])?;
    if marker == 0 {
        return None;
    }

    let before = remove_whitespace(&text[..marker]);
    let hour = parse_clock_number(&take_trailing_number(&before))?;
    if hour > 23.0 {
        return None;
    }

    let marker_char = text[marker..].chars().next()?;
    let rest = &text[marker + marker_char.len_utf8()..];
    let mut minute = 0f64;
    if rest.contains('半') {
        minute = 30.0;
    } else if let Some(fen_idx) = rest.find('分')
        && fen_idx > 0
    {
        let head = remove_whitespace(&rest[..fen_idx]);
        minute = parse_clock_number(&take_trailing_number(&head))?;
    }
    if minute > 59.0 {
        return None;
    }
    Some((hour as u32, minute as u32))
}

fn split_date_time(text: &str) -> (String, Option<String>) {
    let Some(marker) = text.find(|ch: char| ch == 'T' || is_js_whitespace(ch)) else {
        return (text.to_string(), None);
    };
    let marker_char = text[marker..].chars().next().unwrap_or('T');
    (
        text[..marker].to_string(),
        Some(text[marker + marker_char.len_utf8()..].to_string()),
    )
}

fn parse_absolute(text: &str, now: &NowArg) -> Result<Option<f64>, String> {
    if ABSOLUTE_ISO.is_match(text) {
        let ms = parse_js_date(text);
        return Ok(if ms.is_nan() { None } else { Some(ms) });
    }

    let normalized = text
        .replace(['年', '月'], "-")
        .replace('日', "")
        .replace('.', "-");
    let (date, time) = split_date_time(&normalized);
    let full = FULL_DATE.captures(&date);
    let short = if full.is_none() {
        SHORT_DATE.captures(&date)
    } else {
        None
    };
    if full.is_none() && short.is_none() {
        return Ok(None);
    }

    let year = match &full {
        Some(caps) => caps[1].parse::<i32>().ok(),
        None => {
            if !now.is_date {
                return Err("TypeError: now.getFullYear is not a function".to_string());
            }
            Some(get_full_year(now.millis))
        }
    };
    let year = match year {
        Some(year) => year,
        None => return Ok(None),
    };
    let month = match &full {
        Some(caps) => caps[2].parse::<i32>().ok(),
        None => match short.as_ref().and_then(|s| s.get(1)) {
            Some(raw) => raw.as_str().parse::<i32>().ok(),
            None => None,
        },
    };
    let day = match &full {
        Some(caps) => caps[3].parse::<i32>().ok(),
        None => match short.as_ref().and_then(|s| s.get(2)) {
            Some(raw) => raw.as_str().parse::<i32>().ok(),
            None => None,
        },
    };
    let (Some(month), Some(day)) = (month, day) else {
        return Ok(None);
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Ok(None);
    }

    let mut hour = DEFAULT_HOUR as f64;
    let mut minute = 0f64;
    let mut second = 0f64;
    if let Some(time) = time {
        let Some(parts) = CLOCK_PART.captures(&time) else {
            return Ok(None);
        };
        let Some(parsed_hour) = parts[1].parse::<f64>().ok() else {
            return Ok(None);
        };
        let Some(parsed_minute) = parts[2].parse::<f64>().ok() else {
            return Ok(None);
        };
        hour = parsed_hour;
        minute = parsed_minute;
        second = match parts.get(3) {
            Some(raw) => match raw.as_str().parse::<f64>() {
                Ok(value) => value,
                Err(_) => return Ok(None),
            },
            None => 0.0,
        };
    }
    if !is_valid_clock(hour, minute) {
        return Ok(None);
    }

    let mut result = local_epoch(
        year,
        month - 1,
        i64::from(day),
        hour as i64,
        minute as i64,
        second as i64,
    );
    if get_month(result) != month - 1 || get_date(result) as i32 != day {
        return Ok(None);
    }
    if full.is_none() {
        if !now.is_date {
            return Err("TypeError: now.getTime is not a function".to_string());
        }
        if result < now.millis - 180.0 * DAY_MS {
            result = local_epoch(
                year + 1,
                month - 1,
                i64::from(day),
                hour as i64,
                minute as i64,
                second as i64,
            );
        }
    }
    Ok(Some(result))
}

fn find_chinese_duration(text: &str) -> Option<(f64, &'static str)> {
    for unit in CN_DURATION_UNITS {
        let Some(idx) = text.find(unit) else {
            continue;
        };
        let after = &text[idx + unit.len()..];
        if !CN_DURATION_SUFFIXES
            .iter()
            .any(|suffix| after.starts_with(suffix))
        {
            continue;
        }
        let before = remove_whitespace(&text[..idx]);
        let before = before.strip_suffix('个').unwrap_or(before.as_str());
        let Some(amount) = parse_clock_number(&take_trailing_number(before)) else {
            continue;
        };
        return Some((amount, unit));
    }
    None
}

fn parse_duration(text: &str, now: &NowArg) -> Result<Option<f64>, String> {
    if HALF_HOUR.is_match(text) {
        if !now.is_date {
            return Err("TypeError: now.getTime is not a function".to_string());
        }
        return Ok(Some(now.millis + 30.0 * MINUTE_MS));
    }

    if let Some((amount, unit)) = find_chinese_duration(text) {
        if !now.is_date {
            return Err("TypeError: now.getTime is not a function".to_string());
        }
        return Ok(Some(match unit {
            "分钟" | "分" => now.millis + amount * MINUTE_MS,
            "小时" | "钟头" => now.millis + amount * HOUR_MS,
            "天" | "日" => now.millis + amount * DAY_MS,
            _ => now.millis + amount * 7.0 * DAY_MS,
        }));
    }

    if let Some(caps) = EN_DURATION.captures(text) {
        if !now.is_date {
            return Err("TypeError: now.getTime is not a function".to_string());
        }
        let Some(amount) = caps[1].parse::<f64>().ok() else {
            return Ok(None);
        };
        let unit = caps.get(2).map_or("", |m| m.as_str()).to_ascii_lowercase();
        if unit.starts_with("minute") || unit.starts_with("min") {
            return Ok(Some(now.millis + amount * MINUTE_MS));
        }
        if unit.starts_with("hour") || unit.starts_with("hr") {
            return Ok(Some(now.millis + amount * HOUR_MS));
        }
        if unit.starts_with("day") {
            return Ok(Some(now.millis + amount * DAY_MS));
        }
        return Ok(Some(now.millis + amount * 7.0 * DAY_MS));
    }

    Ok(None)
}

fn at_time_with(clock: Option<(u32, u32)>, day: f64) -> f64 {
    match clock {
        Some((hour, minute)) => at_time(day, hour, minute, 0),
        None => at_time(day, DEFAULT_HOUR, 0, 0),
    }
}

fn parse_weekday(text: &str, now: &NowArg) -> Result<Option<f64>, String> {
    if let Some(caps) = CN_WEEKDAY.captures(text) {
        let Some(target) = cn_weekday(&caps[2]) else {
            return Ok(None);
        };
        let prefix = caps.get(1).map_or("", |m| m.as_str()).to_string();
        let clock = extract_clock(text);
        if !now.is_date {
            return Err("TypeError: now.getDay is not a function".to_string());
        }
        let current_dow = match get_day(now.millis) {
            0 => 7i64,
            other => i64::from(other),
        };
        let monday = shift_days(start_of_day(now.millis), 1i64 - current_dow);

        if prefix.starts_with('下') {
            let day = shift_days(monday, 7 + target - 1);
            return Ok(Some(at_time_with(clock, day)));
        }

        let mut day = shift_days(monday, target - 1);
        let mut result = at_time_with(clock, day);
        if prefix.starts_with('本') || prefix.starts_with('这') {
            if result <= now.millis {
                day = shift_days(day, 7);
                result = at_time_with(clock, day);
            }
            return Ok(Some(result));
        }
        if day < start_of_day(now.millis) {
            day = shift_days(day, 7);
        }
        Ok(Some(at_time_with(clock, day)))
    } else if let Some(caps) = EN_WEEKDAY.captures(text) {
        let Some(target) = en_weekday(&caps[2]) else {
            return Ok(None);
        };
        let prefix = caps.get(1).map_or("", |m| m.as_str()).to_ascii_lowercase();
        let clock = extract_english_clock(text);
        if !now.is_date {
            return Err("TypeError: now.getDay is not a function".to_string());
        }
        let current_dow = match get_day(now.millis) {
            0 => 7i64,
            other => i64::from(other),
        };
        let monday = shift_days(start_of_day(now.millis), 1i64 - current_dow);

        if prefix == "next" {
            let day = shift_days(monday, 7 + target - 1);
            return Ok(Some(at_time_with(clock, day)));
        }

        let mut day = shift_days(monday, target - 1);
        if prefix == "this" {
            let mut result = at_time_with(clock, day);
            if result <= now.millis {
                day = shift_days(day, 7);
                result = at_time_with(clock, day);
            }
            return Ok(Some(result));
        }
        if day < start_of_day(now.millis) {
            day = shift_days(day, 7);
        }
        Ok(Some(at_time_with(clock, day)))
    } else {
        Ok(None)
    }
}

fn extract_english_clock(text: &str) -> Option<(u32, u32)> {
    if let Some(caps) = EN_MERIDIEM.captures(text) {
        let mut hour = caps[1].parse::<f64>().ok()?;
        let minute = match caps.get(2) {
            Some(raw) => raw.as_str().parse::<f64>().ok()?,
            None => 0.0,
        };
        let meridiem = caps.get(3).map_or("", |m| m.as_str()).to_ascii_lowercase();
        if meridiem == "pm" && hour < 12.0 {
            hour += 12.0;
        }
        if meridiem == "am" && hour == 12.0 {
            hour = 0.0;
        }
        if !is_valid_clock(hour, minute) {
            return None;
        }
        return Some((hour as u32, minute as u32));
    }

    if let Some(caps) = EN_PLAIN_CLOCK.captures(text) {
        let hour = caps[1].parse::<f64>().ok()?;
        let minute = caps[2].parse::<f64>().ok()?;
        if !is_valid_clock(hour, minute) {
            return None;
        }
        return Some((hour as u32, minute as u32));
    }

    None
}

fn period_default_hour(period: &str) -> u32 {
    PERIOD_DEFAULT_HOUR
        .iter()
        .find(|(name, _)| *name == period)
        .map_or(DEFAULT_HOUR, |(_, hour)| *hour)
}

fn parse_relative_english(text: &str, now: &NowArg) -> Result<Option<f64>, String> {
    let mut offset: Option<i64> = None;
    let mut period: Option<&str> = None;
    for (pattern, days, name) in [
        (&*EN_DAY_AFTER_TOMORROW, 2i64, None),
        (&*EN_TOMORROW, 1, None),
        (&*EN_TONIGHT, 0, Some("晚上")),
        (&*EN_TODAY, 0, None),
    ] {
        if pattern.is_match(text) {
            offset = Some(days);
            period = name;
            break;
        }
    }

    for (pattern, name) in [
        (&*EN_MORNING, "上午"),
        (&*EN_AFTERNOON, "下午"),
        (&*EN_EVENING, "傍晚"),
        (&*EN_NIGHT, "晚上"),
        (&*EN_NOON, "中午"),
    ] {
        if period.is_none() && pattern.is_match(text) {
            period = Some(name);
        }
    }

    if offset.is_none() && period.is_none() {
        return Ok(None);
    }

    let clock = extract_english_clock(text);
    let mut hour;
    let mut minute = 0f64;
    if let Some((h, m)) = clock {
        hour = f64::from(h);
        minute = f64::from(m);
    } else if let Some(period) = period {
        hour = f64::from(period_default_hour(period));
    } else {
        return Ok(None);
    }

    if let Some(period) = period {
        if PM_PERIODS.contains(&period) && hour < 12.0 {
            hour += 12.0;
        }
        if period == "中午" && hour < 11.0 {
            hour += 12.0;
        }
    }

    if !now.is_date {
        return Err("TypeError: date.getFullYear is not a function".to_string());
    }
    let base = shift_days(start_of_day(now.millis), offset.unwrap_or(0));
    let mut result = at_time(base, hour as u32, minute as u32, 0);
    if offset.is_none() && result <= now.millis {
        result = at_time(shift_days(base, 1), hour as u32, minute as u32, 0);
    }
    Ok(Some(result))
}

fn parse_relative_chinese(text: &str, now: &NowArg) -> Result<Option<f64>, String> {
    let mut day_offset: Option<i64> = None;
    let mut day_period: Option<&str> = None;
    for entry in &DAY_WORDS {
        if text.contains(entry.word) {
            day_offset = Some(entry.offset);
            day_period = entry.period;
            break;
        }
    }

    let mut period = day_period;
    if period.is_none() {
        for word in PERIOD_WORDS {
            if text.contains(word) {
                period = Some(word);
                break;
            }
        }
    }

    let clock = extract_clock(text);
    if day_offset.is_none() && period.is_none() && clock.is_none() {
        return Ok(None);
    }

    let mut hour;
    let mut minute = 0f64;
    if let Some((h, m)) = clock {
        hour = f64::from(h);
        minute = f64::from(m);
    } else if let Some(period) = period {
        hour = f64::from(period_default_hour(period));
    } else {
        return Ok(None);
    }

    if let Some(period) = period {
        if PM_PERIODS.contains(&period) {
            if hour < 12.0 {
                hour += 12.0;
            } else if hour == 12.0 {
                hour = 0.0;
            }
        }
        if period == "中午" && hour < 11.0 {
            hour += 12.0;
        }
        if period == "凌晨" && hour == 12.0 {
            hour = 0.0;
        }
    }

    if !now.is_date {
        return Err("TypeError: date.getFullYear is not a function".to_string());
    }
    let base = shift_days(start_of_day(now.millis), day_offset.unwrap_or(0));
    let mut result = at_time(base, hour as u32, minute as u32, 0);

    if period.is_none() && day_offset.is_none() {
        let pm = at_time(base, (hour + 12.0) as u32, minute as u32, 0);
        if result <= now.millis && pm > now.millis && hour < 12.0 {
            result = pm;
        }
    }
    if day_offset.is_none() && result <= now.millis {
        result = at_time(shift_days(base, 1), hour as u32, minute as u32, 0);
    }

    Ok(Some(result))
}

fn iso_string(ms: f64) -> Value {
    if !ms.is_finite() {
        return json!({ "$date": "Invalid" });
    }
    let dt = chrono::DateTime::from_timestamp_millis(ms as i64).unwrap_or_else(chrono::Utc::now);
    json!({ "$date": dt.to_rfc3339_opts(SecondsFormat::Millis, true) })
}

fn truthy(value: &Value) -> bool {
    if js::is_undefined(value) {
        return false;
    }
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS new Date(value) for the values a reminder row carries.
fn js_date_of(value: &Value) -> f64 {
    if let Some(ms) = date_millis(value) {
        return ms;
    }
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => parse_js_date(text),
        _ => f64::NAN,
    }
}

/// JS new Date(value) with the constructor's own rules.
fn js_new_date(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(*b),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => parse_js_date(text),
        Value::Array(items) => parse_js_date(&array_to_string(items)),
        _ => {
            if let Some(ms) = date_millis(value) {
                return ms;
            }
            if value.is_object() {
                return parse_js_date("[object Object]");
            }
            f64::NAN
        }
    }
}

/// The string an array turns into, the way Array.prototype.toString joins it.
fn array_to_string(items: &[Value]) -> String {
    items
        .iter()
        .map(|item| match item {
            Value::Null => String::new(),
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .collect::<Vec<String>>()
        .join(",")
}

fn remind_at_of(row: &Value) -> Result<Option<&Value>, String> {
    if row.is_null() || js::is_undefined(row) {
        let kind = if row.is_null() { "null" } else { "undefined" };
        return Err(format!(
            "TypeError: Cannot read properties of {kind} (reading 'remind_at')"
        ));
    }
    Ok(row.get("remind_at"))
}

/// Port of pickDueReminders (src/shared/todo/reminderDue.ts:9).
pub fn pick_due_reminders(rows: Value, now: Value, grace_ms: f64) -> Result<Vec<Value>, String> {
    let now_ms = require_date_prop(&now, "now", "getTime")?;
    let Value::Array(items) = rows else {
        return Err("TypeError: rows.filter is not a function".to_string());
    };
    let mut out: Vec<Value> = Vec::new();
    for row in items {
        let Some(remind_at) = remind_at_of(&row)? else {
            continue;
        };
        if !truthy(remind_at) {
            continue;
        }
        let at = js_date_of(remind_at);
        if at.is_nan() {
            continue;
        }
        if at > now_ms {
            continue;
        }
        if now_ms - at <= grace_ms {
            out.push(row);
        }
    }
    Ok(out)
}

/// Port of isExpiredReminder (src/shared/todo/reminderDue.ts:24).
pub fn is_expired_reminder(row: Value, now: Value, grace_ms: f64) -> Result<bool, String> {
    let Some(remind_at) = remind_at_of(&row)? else {
        return Ok(false);
    };
    if !truthy(remind_at) {
        return Ok(false);
    }
    let at = js_date_of(remind_at);
    if at.is_nan() {
        return Ok(false);
    }
    let now_ms = require_date_prop(&now, "now", "getTime")?;
    Ok(now_ms - at > grace_ms)
}

/// Port of resolveReminderTime (src/shared/todo/reminderTime.ts:520).
pub fn resolve_reminder_time(input: String, now: Value) -> Result<Value, String> {
    let now_arg = now_arg(&now);
    let text = js_trim(&input);
    if text.is_empty() {
        return Ok(json!({ "ok": false, "error": "提醒时间为空" }));
    }

    if let Some(at) = parse_absolute(&text, &now_arg)? {
        return Ok(json!({ "ok": true, "at": iso_string(at) }));
    }
    if let Some(at) = parse_duration(&text, &now_arg)? {
        return Ok(json!({ "ok": true, "at": iso_string(at) }));
    }
    if let Some(at) = parse_weekday(&text, &now_arg)? {
        return Ok(json!({ "ok": true, "at": iso_string(at) }));
    }
    if let Some(at) = parse_relative_english(&text, &now_arg)? {
        return Ok(json!({ "ok": true, "at": iso_string(at) }));
    }
    if let Some(at) = parse_relative_chinese(&text, &now_arg)? {
        return Ok(json!({ "ok": true, "at": iso_string(at) }));
    }

    Ok(json!({
        "ok": false,
        "error": format!(
            "无法识别提醒时间「{text}」，请换成「明天下午3点」「30分钟后」「2026-11-19 15:30」这类写法"
        ),
    }))
}

/// Port of dayDiff (src/shared/todo/reminderTime.ts:548).
pub fn day_diff(from: Value, to: Value) -> Result<f64, String> {
    let from_ms = require_date_prop(&from, "date", "getFullYear")?;
    let to_ms = require_date_prop(&to, "date", "getFullYear")?;
    let a = start_of_day(from_ms);
    let b = start_of_day(to_ms);
    Ok(js_round((b - a) / DAY_MS))
}

/// Port of formatReminderLabel (src/shared/todo/reminderTime.ts:554).
pub fn format_reminder_label(at: Value, now: Value) -> Result<String, String> {
    let at_ms = require_date_prop(&at, "at", "getTime")?;
    if at_ms.is_nan() {
        return Ok(String::new());
    }
    let now_arg = now_arg(&now);
    let time = format!("{}:{}", pad2(get_hours(at_ms)), pad2(get_minutes(at_ms)));
    let diff = day_diff(iso_string(now_arg.millis), iso_string(at_ms))?;
    if diff == 0.0 {
        return Ok(format!("今天 {time}"));
    }
    if diff == 1.0 {
        return Ok(format!("明天 {time}"));
    }
    if diff == -1.0 {
        return Ok(format!("昨天 {time}"));
    }
    if diff > 1.0 && diff < 7.0 {
        return Ok(format!("{diff} 天后 {time}"));
    }
    Ok(format!(
        "{}月{}日 {time}",
        get_month(at_ms) + 1,
        get_date(at_ms)
    ))
}

/// Port of formatLocalDateTime (src/shared/todo/reminderTime.ts:565).
pub fn format_local_date_time(at: Option<Value>) -> Result<String, String> {
    let Some(value) = at else {
        return Ok(String::new());
    };
    if !truthy(&value) {
        return Ok(String::new());
    }
    let ms = require_date_prop(&value, "at", "getTime")?;
    if ms.is_nan() {
        return Ok(String::new());
    }
    Ok(format!(
        "{}-{:02}-{:02} {:02}:{:02}",
        get_full_year(ms),
        get_month(ms) + 1,
        get_date(ms),
        get_hours(ms),
        get_minutes(ms)
    ))
}

/// Port of toDateTimeLocalValue (src/shared/todo/reminderTime.ts:572).
pub fn to_date_time_local_value(at: Option<Value>) -> Result<String, String> {
    let Some(value) = at else {
        return Ok(String::new());
    };
    if !truthy(&value) {
        return Ok(String::new());
    }
    let ms = require_date_prop(&value, "at", "getTime")?;
    if ms.is_nan() {
        return Ok(String::new());
    }
    Ok(format!(
        "{}-{:02}-{:02}T{:02}:{:02}",
        get_full_year(ms),
        get_month(ms) + 1,
        get_date(ms),
        get_hours(ms),
        get_minutes(ms)
    ))
}

/// Port of fromDateTimeLocalValue (src/shared/todo/reminderTime.ts:579).
pub fn from_date_time_local_value(value: String) -> Result<Value, String> {
    let text = js_trim(&value);
    if text.is_empty() {
        return Ok(Value::Null);
    }
    let ms = parse_js_date(&text);
    if ms.is_nan() {
        return Ok(Value::Null);
    }
    Ok(iso_string(ms))
}

/// Port of getWeekRange (src/shared/todo/weekRange.ts:39).
pub fn get_week_range(now: Value) -> Result<Value, String> {
    let now_ms = if js::is_undefined(&now) {
        now_millis()
    } else {
        js_new_date(&now)
    };
    let invalid = json!({ "start": iso_string(f64::NAN), "end": iso_string(f64::NAN) });
    let start = start_of_day(now_ms);
    if start.is_nan() {
        return Ok(invalid);
    }
    let offset = i64::from((get_day(start) + 6) % 7);
    let monday = shift_days(start, -offset);
    let sunday = shift_days(monday, 6);
    let end = local_epoch(
        get_full_year(sunday),
        get_month(sunday),
        i64::from(get_date(sunday)),
        23,
        59,
        59,
    ) + 999.0;
    Ok(json!({ "start": iso_string(monday), "end": iso_string(end) }))
}

/// Port of isInWeek (src/shared/todo/weekRange.ts:49).
pub fn is_in_week(value: Value, range: Value) -> Result<bool, String> {
    let Some(at) = parse_todo_time(&value)? else {
        return Ok(false);
    };
    let start = range_bound(&range, "start")?;
    let end = range_bound(&range, "end")?;
    Ok(at >= start && at <= end)
}

/// The epoch a range bound stands for, or the error JS would throw.
fn range_bound(range: &Value, key: &str) -> Result<f64, String> {
    if range.is_null() || js::is_undefined(range) {
        let kind = if range.is_null() { "null" } else { "undefined" };
        return Err(format!(
            "TypeError: Cannot read properties of {kind} (reading '{key}')"
        ));
    }
    let Some(bound) = range.get(key) else {
        return Err(
            "TypeError: Cannot read properties of undefined (reading 'getTime')".to_string(),
        );
    };
    if bound.is_null() {
        return Err("TypeError: Cannot read properties of null (reading 'getTime')".to_string());
    }
    if js::is_undefined(bound) {
        return Err(
            "TypeError: Cannot read properties of undefined (reading 'getTime')".to_string(),
        );
    }
    match date_millis(bound) {
        Some(ms) => Ok(ms),
        None => Err(format!("TypeError: range.{key}.getTime is not a function")),
    }
}

/// Port of isInCurrentWeek (src/shared/todo/weekRange.ts:59).
pub fn is_in_current_week(value: Value, now: Value) -> Result<bool, String> {
    let range = get_week_range(now)?;
    is_in_week(value, range)
}

/// Port of isTodoInWeek (src/shared/todo/weekRange.ts:66).
pub fn is_todo_in_week(todo: Value, range: Value) -> Result<bool, String> {
    if todo.is_null() || js::is_undefined(&todo) {
        let kind = if todo.is_null() { "null" } else { "undefined" };
        return Err(format!(
            "TypeError: Cannot read properties of {kind} (reading 'completed_at')"
        ));
    }
    let completed = todo.get("completed_at").cloned().unwrap_or(Value::Null);
    if is_in_week(completed, range.clone())? {
        return Ok(true);
    }
    let created = todo.get("created_at").cloned().unwrap_or(Value::Null);
    is_in_week(created, range)
}
