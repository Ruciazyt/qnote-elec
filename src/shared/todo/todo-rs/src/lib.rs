//! JS bindings for `src/shared/todo/`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `pickDueReminders`.
#[napi(js_name = "pickDueReminders")]
pub fn pick_due_reminders(rows: String, now: String, grace_ms: f64) -> napi::Result<String> {
    run(move || {
        let rows = crate::js::from_json(&rows)?;
        let now = crate::js::from_json(&now)?;
        let out = port::pick_due_reminders(rows, now, grace_ms)?;
        crate::js::to_json(&out)
    })
}

/// `isExpiredReminder`.
#[napi(js_name = "isExpiredReminder")]
pub fn is_expired_reminder(row: String, now: String, grace_ms: f64) -> napi::Result<bool> {
    run(move || {
        let row = crate::js::from_json(&row)?;
        let now = crate::js::from_json(&now)?;
        let out = port::is_expired_reminder(row, now, grace_ms)?;
        Ok(out)
    })
}

/// `resolveReminderTime`.
#[napi(js_name = "resolveReminderTime")]
pub fn resolve_reminder_time(input: String, now: String) -> napi::Result<String> {
    run(move || {
        let now = crate::js::from_json(&now)?;
        let out = port::resolve_reminder_time(input, now)?;
        crate::js::to_json(&out)
    })
}

/// `dayDiff`.
#[napi(js_name = "dayDiff")]
pub fn day_diff(from: String, to: String) -> napi::Result<f64> {
    run(move || {
        let from = crate::js::from_json(&from)?;
        let to = crate::js::from_json(&to)?;
        let out = port::day_diff(from, to)?;
        Ok(out)
    })
}

/// `formatReminderLabel`.
#[napi(js_name = "formatReminderLabel")]
pub fn format_reminder_label(at: String, now: String) -> napi::Result<String> {
    run(move || {
        let at = crate::js::from_json(&at)?;
        let now = crate::js::from_json(&now)?;
        let out = port::format_reminder_label(at, now)?;
        Ok(out)
    })
}

/// `formatLocalDateTime`.
#[napi(js_name = "formatLocalDateTime")]
pub fn format_local_date_time(at: String) -> napi::Result<String> {
    run(move || {
        let at = crate::js::from_json(&at)?;
        let out = port::format_local_date_time(at)?;
        Ok(out)
    })
}

/// `toDateTimeLocalValue`.
#[napi(js_name = "toDateTimeLocalValue")]
pub fn to_date_time_local_value(at: String) -> napi::Result<String> {
    run(move || {
        let at = crate::js::from_json(&at)?;
        let out = port::to_date_time_local_value(at)?;
        Ok(out)
    })
}

/// `fromDateTimeLocalValue`.
#[napi(js_name = "fromDateTimeLocalValue")]
pub fn from_date_time_local_value(value: String) -> napi::Result<String> {
    run(move || {
        let out = port::from_date_time_local_value(value)?;
        crate::js::to_json(&out)
    })
}

/// `getWeekRange`.
#[napi(js_name = "getWeekRange")]
pub fn get_week_range(now: String) -> napi::Result<String> {
    run(move || {
        let now = crate::js::from_json(&now)?;
        let out = port::get_week_range(now)?;
        crate::js::to_json(&out)
    })
}

/// `isInWeek`.
#[napi(js_name = "isInWeek")]
pub fn is_in_week(value: String, range: String) -> napi::Result<bool> {
    run(move || {
        let value = crate::js::from_json(&value)?;
        let range = crate::js::from_json(&range)?;
        let out = port::is_in_week(value, range)?;
        Ok(out)
    })
}

/// `isInCurrentWeek`.
#[napi(js_name = "isInCurrentWeek")]
pub fn is_in_current_week(value: String, now: String) -> napi::Result<bool> {
    run(move || {
        let value = crate::js::from_json(&value)?;
        let now = crate::js::from_json(&now)?;
        let out = port::is_in_current_week(value, now)?;
        Ok(out)
    })
}

/// `isTodoInWeek`.
#[napi(js_name = "isTodoInWeek")]
pub fn is_todo_in_week(todo: String, range: String) -> napi::Result<bool> {
    run(move || {
        let todo = crate::js::from_json(&todo)?;
        let range = crate::js::from_json(&range)?;
        let out = port::is_todo_in_week(todo, range)?;
        Ok(out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE: std::cell::RefCell<Option<(napi::bindgen_prelude::Uint8Array, napi::bindgen_prelude::Uint8Array)>> =
        const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument and result buffers `index.cjs` writes to and reads from.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads `len` argument bytes, runs `f`, and writes its result; a negative return is the size
/// of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len as usize).min(input.len());
        let mut w = wire::Writer::default();
        match run(|| f(&mut wire::Reader::new(&input[..len]), &mut w)) {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => return Ok(f64::NAN),
            other => other?,
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        Ok(n as f64)
    })
}

static S_PICK_DUE_REMINDERS_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("title", wire::Schema::Str16),
    ("notes", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("priority", wire::Schema::Str16),
    ("remind_at", wire::Schema::OptJs(&wire::Schema::Str16)),
]));
static S_PICK_DUE_REMINDERS_1: wire::Schema = wire::Schema::Dyn;
static S_PICK_DUE_REMINDERS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("title", wire::Schema::Str16),
    ("notes", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("priority", wire::Schema::Str16),
    ("remind_at", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `pickDueReminders` over the binary wire.
#[napi(js_name = "pickDueRemindersWire")]
pub fn pick_due_reminders_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let rows: Value = wire::read_value(r, &S_PICK_DUE_REMINDERS_0)?;
        let now: Value = wire::read_value(r, &S_PICK_DUE_REMINDERS_1)?;
        let grace_ms: f64 = r.f64()?;
        let out = &port::pick_due_reminders(rows, now, grace_ms)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PICK_DUE_REMINDERS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_IS_EXPIRED_REMINDER_0: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("title", wire::Schema::Str16),
    ("notes", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("priority", wire::Schema::Str16),
    ("remind_at", wire::Schema::OptJs(&wire::Schema::Str16)),
]);
static S_IS_EXPIRED_REMINDER_1: wire::Schema = wire::Schema::Dyn;

/// `isExpiredReminder` over the binary wire.
#[napi(js_name = "isExpiredReminderWire")]
pub fn is_expired_reminder_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let row: Value = wire::read_value(r, &S_IS_EXPIRED_REMINDER_0)?;
        let now: Value = wire::read_value(r, &S_IS_EXPIRED_REMINDER_1)?;
        let grace_ms: f64 = r.f64()?;
        let out = &port::is_expired_reminder(row, now, grace_ms)?;
        w.bool(*out);
        Ok(())
    })
}

static S_RESOLVE_REMINDER_TIME_1: wire::Schema = wire::Schema::Dyn;
static S_RESOLVE_REMINDER_TIME_OUT: wire::Schema = wire::Schema::Obj(&[
    ("ok", wire::Schema::Bool),
    ("at", wire::Schema::Dyn),
    ("error", wire::Schema::OptJs(&wire::Schema::Str16)),
]);

/// `resolveReminderTime` over the binary wire.
#[napi(js_name = "resolveReminderTimeWire")]
pub fn resolve_reminder_time_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let input: String = r.string16()?;
        let now: Value = wire::read_value(r, &S_RESOLVE_REMINDER_TIME_1)?;
        let out = &port::resolve_reminder_time(input, now)?;
        wire::write_value(w, out, &S_RESOLVE_REMINDER_TIME_OUT)?;
        Ok(())
    })
}

static S_DAY_DIFF_0: wire::Schema = wire::Schema::Dyn;
static S_DAY_DIFF_1: wire::Schema = wire::Schema::Dyn;

/// `dayDiff` over the binary wire.
#[napi(js_name = "dayDiffWire")]
pub fn day_diff_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let from: Value = wire::read_value(r, &S_DAY_DIFF_0)?;
        let to: Value = wire::read_value(r, &S_DAY_DIFF_1)?;
        let out = &port::day_diff(from, to)?;
        w.f64(*out);
        Ok(())
    })
}

static S_FORMAT_REMINDER_LABEL_0: wire::Schema = wire::Schema::Dyn;
static S_FORMAT_REMINDER_LABEL_1: wire::Schema = wire::Schema::Dyn;

/// `formatReminderLabel` over the binary wire.
#[napi(js_name = "formatReminderLabelWire")]
pub fn format_reminder_label_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let at: Value = wire::read_value(r, &S_FORMAT_REMINDER_LABEL_0)?;
        let now: Value = wire::read_value(r, &S_FORMAT_REMINDER_LABEL_1)?;
        let out = &port::format_reminder_label(at, now)?;
        w.string16(out);
        Ok(())
    })
}

/// `formatLocalDateTime` over the binary wire.
#[napi(js_name = "formatLocalDateTimeWire")]
pub fn format_local_date_time_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let at: Option<Value> =
            serde_json::from_value(wire::read_dyn(r)?).map_err(|e| format!("TypeError: {e}"))?;
        let out = &port::format_local_date_time(at)?;
        w.string16(out);
        Ok(())
    })
}

/// `toDateTimeLocalValue` over the binary wire.
#[napi(js_name = "toDateTimeLocalValueWire")]
pub fn to_date_time_local_value_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let at: Option<Value> =
            serde_json::from_value(wire::read_dyn(r)?).map_err(|e| format!("TypeError: {e}"))?;
        let out = &port::to_date_time_local_value(at)?;
        w.string16(out);
        Ok(())
    })
}

static S_FROM_DATE_TIME_LOCAL_VALUE_OUT: wire::Schema = wire::Schema::Dyn;

/// `fromDateTimeLocalValue` over the binary wire.
#[napi(js_name = "fromDateTimeLocalValueWire")]
pub fn from_date_time_local_value_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let value: String = r.string16()?;
        let out = &port::from_date_time_local_value(value)?;
        wire::write_value(w, out, &S_FROM_DATE_TIME_LOCAL_VALUE_OUT)?;
        Ok(())
    })
}

static S_GET_WEEK_RANGE_0: wire::Schema = wire::Schema::Dyn;
static S_GET_WEEK_RANGE_OUT: wire::Schema =
    wire::Schema::Obj(&[("start", wire::Schema::Dyn), ("end", wire::Schema::Dyn)]);

/// `getWeekRange` over the binary wire.
#[napi(js_name = "getWeekRangeWire")]
pub fn get_week_range_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let now: Value = wire::read_value(r, &S_GET_WEEK_RANGE_0)?;
        let out = &port::get_week_range(now)?;
        wire::write_value(w, out, &S_GET_WEEK_RANGE_OUT)?;
        Ok(())
    })
}

static S_IS_IN_WEEK_0: wire::Schema = wire::Schema::Dyn;
static S_IS_IN_WEEK_1: wire::Schema =
    wire::Schema::Obj(&[("start", wire::Schema::Dyn), ("end", wire::Schema::Dyn)]);

/// `isInWeek` over the binary wire.
#[napi(js_name = "isInWeekWire")]
pub fn is_in_week_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_IS_IN_WEEK_0)?;
        let range: Value = wire::read_value(r, &S_IS_IN_WEEK_1)?;
        let out = &port::is_in_week(value, range)?;
        w.bool(*out);
        Ok(())
    })
}

static S_IS_IN_CURRENT_WEEK_0: wire::Schema = wire::Schema::Dyn;
static S_IS_IN_CURRENT_WEEK_1: wire::Schema = wire::Schema::Dyn;

/// `isInCurrentWeek` over the binary wire.
#[napi(js_name = "isInCurrentWeekWire")]
pub fn is_in_current_week_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_IS_IN_CURRENT_WEEK_0)?;
        let now: Value = wire::read_value(r, &S_IS_IN_CURRENT_WEEK_1)?;
        let out = &port::is_in_current_week(value, now)?;
        w.bool(*out);
        Ok(())
    })
}

static S_IS_TODO_IN_WEEK_0: wire::Schema = wire::Schema::Obj(&[
    ("created_at", wire::Schema::Dyn),
    ("completed_at", wire::Schema::Dyn),
]);
static S_IS_TODO_IN_WEEK_1: wire::Schema =
    wire::Schema::Obj(&[("start", wire::Schema::Dyn), ("end", wire::Schema::Dyn)]);

/// `isTodoInWeek` over the binary wire.
#[napi(js_name = "isTodoInWeekWire")]
pub fn is_todo_in_week_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let todo: Value = wire::read_value(r, &S_IS_TODO_IN_WEEK_0)?;
        let range: Value = wire::read_value(r, &S_IS_TODO_IN_WEEK_1)?;
        let out = &port::is_todo_in_week(todo, range)?;
        w.bool(*out);
        Ok(())
    })
}
