export interface ReminderTimeResolution {
  ok: boolean;
  at?: Date;
  error?: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_HOUR = 9;

const PERIOD_DEFAULT_HOUR: Record<string, number> = {
  凌晨: 3,
  清晨: 6,
  早晨: 8,
  早上: 8,
  上午: 9,
  中午: 12,
  下午: 14,
  傍晚: 18,
  晚上: 20,
  夜里: 21,
};

const PERIOD_WORDS = [
  "凌晨",
  "清晨",
  "早晨",
  "早上",
  "上午",
  "中午",
  "下午",
  "傍晚",
  "晚上",
  "夜里",
];

const PM_PERIODS = new Set(["下午", "傍晚", "晚上", "夜里"]);

function findPeriodWord(text: string): string | undefined {
  for (const word of PERIOD_WORDS) {
    if (text.includes(word)) return word;
  }
  return undefined;
}

function applyPeriodToHour(hour: number, period: string | undefined): number {
  if (!period) return hour;
  let out = hour;
  if (PM_PERIODS.has(period)) {
    if (out < 12) out += 12;
    else if (out === 12) out = 0;
  }
  if (period === "中午" && out < 11) out += 12;
  if (period === "凌晨" && out === 12) out = 0;
  return out;
}

interface DayWord {
  word: string;
  offset: number;
  period?: string;
}

const DAY_WORDS: DayWord[] = [
  { word: "大后天", offset: 3 },
  { word: "后天", offset: 2 },
  { word: "明早", offset: 1, period: "早上" },
  { word: "明晚", offset: 1, period: "晚上" },
  { word: "明天", offset: 1 },
  { word: "明日", offset: 1 },
  { word: "今天", offset: 0 },
  { word: "今日", offset: 0 },
  { word: "今晚", offset: 0, period: "晚上" },
  { word: "今早", offset: 0, period: "早上" },
  { word: "昨天", offset: -1 },
  { word: "前天", offset: -2 },
];

const CN_WEEKDAY: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

const EN_WEEKDAY: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_NUMBER_CHARS = "[零〇一二两三四五六七八九十]";

const CN_NUMBER_CHAR_SET = new Set(CN_NUMBER_CHARS.slice(1, -1).split(""));

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function takeTrailingNumber(text: string): string {
  let start = text.length;
  while (start > 0) {
    const ch = text[start - 1];
    if (isDigit(ch) || CN_NUMBER_CHAR_SET.has(ch)) {
      start -= 1;
      continue;
    }
    break;
  }
  return text.slice(start);
}

const CN_DURATION_UNITS = ["分钟", "分", "小时", "钟头", "天", "日", "周", "星期", "礼拜"];

const CN_DURATION_SUFFIXES = ["以后", "之后", "后"];

interface Clock {
  hour: number;
  minute: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function atTime(base: Date, hour: number, minute: number, second = 0): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hour,
    minute,
    second
  );
}

function isValidClock(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function parseChineseNumber(raw: string): number | null {
  if (!raw) return null;
  if (raw.length === 1) {
    return CN_DIGITS[raw] ?? null;
  }
  const shi = raw.indexOf("十");
  if (shi >= 0) {
    const tens = shi === 0 ? 1 : (CN_DIGITS[raw[shi - 1]] ?? null);
    if (tens === null) return null;
    const ones = shi === raw.length - 1 ? 0 : (CN_DIGITS[raw[shi + 1]] ?? null);
    if (ones === null) return null;
    return tens * 10 + ones;
  }
  let value = 0;
  for (const ch of raw) {
    const digit = CN_DIGITS[ch];
    if (digit === undefined) return null;
    value = value * 10 + digit;
  }
  return value;
}

function parseClockNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return parseChineseNumber(raw);
}

function extractClock(text: string): Clock | null {
  const colon = /(\d{1,2})\s?[:：]\s?(\d{1,2})/.exec(text);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (!isValidClock(hour, minute)) return null;
    return { hour, minute };
  }

  const marker = text.search(/[点时]/);
  if (marker <= 0) return null;

  const before = text.slice(0, marker).replace(/\s/g, "");
  const hour = parseClockNumber(takeTrailingNumber(before));
  if (hour === null || hour > 23) return null;

  let minute = 0;
  const rest = text.slice(marker + 1);
  if (rest.includes("半")) {
    minute = 30;
  } else {
    const fenIdx = rest.indexOf("分");
    if (fenIdx > 0) {
      const parsed = parseClockNumber(
        takeTrailingNumber(rest.slice(0, fenIdx).replace(/\s/g, ""))
      );
      if (parsed === null) return null;
      minute = parsed;
    }
  }
  if (minute > 59) return null;
  return { hour, minute };
}

function splitDateTime(text: string): { date: string; time: string | null } {
  const idx = text.search(/[T\s]/);
  if (idx < 0) return { date: text, time: null };
  return { date: text.slice(0, idx), time: text.slice(idx + 1) };
}

function parseAbsolute(text: string, now: Date): Date | null {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = text
    .replace(/[年月]/g, "-")
    .replace(/日/g, "")
    .replace(/\./g, "-");

  const { date, time } = splitDateTime(normalized);
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  const short = full ? null : /^(\d{1,2})-(\d{1,2})$/.exec(date);
  if (!full && !short) return null;

  const year = full ? Number(full[1]) : now.getFullYear();
  const month = full ? Number(full[2]) : Number(short![1]);
  const day = full ? Number(full[3]) : Number(short![2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let hour = DEFAULT_HOUR;
  let minute = 0;
  let second = 0;
  if (time) {
    const parts = /^(\d{1,2})[:：](\d{1,2})(?::(\d{1,2}))?$/.exec(time);
    if (!parts) return null;
    hour = Number(parts[1]);
    minute = Number(parts[2]);
    second = parts[3] ? Number(parts[3]) : 0;
  }
  if (!isValidClock(hour, minute)) return null;

  let result = new Date(year, month - 1, day, hour, minute, second);
  if (result.getMonth() !== month - 1 || result.getDate() !== day) return null;

  if (!full && result.getTime() < now.getTime() - 180 * DAY_MS) {
    result = new Date(year + 1, month - 1, day, hour, minute, second);
  }
  return result;
}

function findChineseDuration(text: string): { amount: number; unit: string } | null {
  for (const unit of CN_DURATION_UNITS) {
    const idx = text.indexOf(unit);
    if (idx < 0) continue;
    const after = text.slice(idx + unit.length);
    if (!CN_DURATION_SUFFIXES.some((suffix) => after.startsWith(suffix))) continue;
    const before = text.slice(0, idx).replace(/\s/g, "").replace(/个$/, "");
    const amount = parseClockNumber(takeTrailingNumber(before));
    if (amount === null) continue;
    return { amount, unit };
  }
  return null;
}

function parseDuration(text: string, now: Date): Date | null {
  const half = /半(?:个)?\s*(小时|钟头)(?:后|以后|之后)/.exec(text);
  if (half) {
    return new Date(now.getTime() + 30 * MINUTE_MS);
  }

  const cn = findChineseDuration(text);
  if (cn) {
    const amount = cn.amount;
    if (cn.unit === "分钟" || cn.unit === "分") {
      return new Date(now.getTime() + amount * MINUTE_MS);
    }
    if (cn.unit === "小时" || cn.unit === "钟头") {
      return new Date(now.getTime() + amount * HOUR_MS);
    }
    if (cn.unit === "天" || cn.unit === "日") {
      return new Date(now.getTime() + amount * DAY_MS);
    }
    return new Date(now.getTime() + amount * 7 * DAY_MS);
  }

  const en = /\bin\s+(\d+)\s*(minute|min|hour|hr|day|week)s?/i.exec(text);
  if (en) {
    const amount = Number(en[1]);
    const unit = en[2].toLowerCase();
    if (unit.startsWith("minute") || unit.startsWith("min")) {
      return new Date(now.getTime() + amount * MINUTE_MS);
    }
    if (unit.startsWith("hour") || unit.startsWith("hr")) {
      return new Date(now.getTime() + amount * HOUR_MS);
    }
    if (unit.startsWith("day")) {
      return new Date(now.getTime() + amount * DAY_MS);
    }
    return new Date(now.getTime() + amount * 7 * DAY_MS);
  }

  return null;
}

function parseWeekday(text: string, now: Date): Date | null {
  const cn = /(下|本|这|下个|这个)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text);
  if (cn) {
    const target = CN_WEEKDAY[cn[2]];
    if (!target) return null;
    const prefix = cn[1] ?? "";
    const clock = extractClock(text);
    const period = findPeriodWord(text);
    const hour = clock
      ? applyPeriodToHour(clock.hour, period)
      : period
        ? PERIOD_DEFAULT_HOUR[period] ?? DEFAULT_HOUR
        : undefined;
    const minute = clock ? clock.minute : 0;
    const currentDow = now.getDay() === 0 ? 7 : now.getDay();
    const mondayOfThisWeek = shiftDays(startOfDay(now), 1 - currentDow);

    if (prefix.startsWith("下")) {
      const day = shiftDays(mondayOfThisWeek, 7 + target - 1);
      return hour === undefined ? atTime(day, DEFAULT_HOUR, 0) : atTime(day, hour, minute);
    }

    let day = shiftDays(mondayOfThisWeek, target - 1);
    let result = hour === undefined ? atTime(day, DEFAULT_HOUR, 0) : atTime(day, hour, minute);
    if (prefix.startsWith("本") || prefix.startsWith("这")) {
      if (result.getTime() <= now.getTime()) {
        day = shiftDays(day, 7);
        result = hour === undefined ? atTime(day, DEFAULT_HOUR, 0) : atTime(day, hour, minute);
      }
      return result;
    }
    if (day.getTime() < startOfDay(now).getTime()) {
      day = shiftDays(day, 7);
    }
    return hour === undefined ? atTime(day, DEFAULT_HOUR, 0) : atTime(day, hour, minute);
  }

  const en = /\b(next|this|coming)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
    text
  );
  if (en) {
    const target = EN_WEEKDAY[en[2].toLowerCase()];
    const prefix = (en[1] ?? "").toLowerCase();
    const clock = extractEnglishClock(text);
    const currentDow = now.getDay() === 0 ? 7 : now.getDay();
    const mondayOfThisWeek = shiftDays(startOfDay(now), 1 - currentDow);

    if (prefix === "next") {
      const day = shiftDays(mondayOfThisWeek, 7 + target - 1);
      return clock ? atTime(day, clock.hour, clock.minute) : atTime(day, DEFAULT_HOUR, 0);
    }

    let day = shiftDays(mondayOfThisWeek, target - 1);
    if (prefix === "this") {
      let result = clock ? atTime(day, clock.hour, clock.minute) : atTime(day, DEFAULT_HOUR, 0);
      if (result.getTime() <= now.getTime()) {
        day = shiftDays(day, 7);
        result = clock ? atTime(day, clock.hour, clock.minute) : atTime(day, DEFAULT_HOUR, 0);
      }
      return result;
    }
    if (day.getTime() < startOfDay(now).getTime()) {
      day = shiftDays(day, 7);
    }
    return clock ? atTime(day, clock.hour, clock.minute) : atTime(day, DEFAULT_HOUR, 0);
  }

  return null;
}

function extractEnglishClock(text: string): Clock | null {
  const withMeridiem = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (withMeridiem) {
    let hour = Number(withMeridiem[1]);
    const minute = withMeridiem[2] ? Number(withMeridiem[2]) : 0;
    const meridiem = withMeridiem[3].toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (!isValidClock(hour, minute)) return null;
    return { hour, minute };
  }

  const plain = /\b(\d{1,2}):(\d{2})\b/.exec(text);
  if (plain) {
    const hour = Number(plain[1]);
    const minute = Number(plain[2]);
    if (!isValidClock(hour, minute)) return null;
    return { hour, minute };
  }

  return null;
}

function parseRelativeEnglish(text: string, now: Date): Date | null {
  const dayWords: { pattern: RegExp; offset: number; period?: string }[] = [
    { pattern: /\bday after tomorrow\b/i, offset: 2 },
    { pattern: /\btomorrow\b/i, offset: 1 },
    { pattern: /\btonight\b/i, offset: 0, period: "晚上" },
    { pattern: /\btoday\b/i, offset: 0 },
  ];

  let offset: number | null = null;
  let period: string | undefined;
  for (const entry of dayWords) {
    if (entry.pattern.test(text)) {
      offset = entry.offset;
      period = entry.period;
      break;
    }
  }

  const periodWords: { pattern: RegExp; name: string }[] = [
    { pattern: /\bmorning\b/i, name: "上午" },
    { pattern: /\bafternoon\b/i, name: "下午" },
    { pattern: /\bevening\b/i, name: "傍晚" },
    { pattern: /\bnight\b/i, name: "晚上" },
    { pattern: /\bnoon\b/i, name: "中午" },
  ];
  for (const entry of periodWords) {
    if (!period && entry.pattern.test(text)) period = entry.name;
  }

  if (offset === null && !period) return null;

  const clock = extractEnglishClock(text);
  let hour: number;
  let minute = 0;
  if (clock) {
    hour = clock.hour;
    minute = clock.minute;
  } else if (period) {
    hour = PERIOD_DEFAULT_HOUR[period] ?? DEFAULT_HOUR;
  } else {
    return null;
  }

  if (period) {
    if (PM_PERIODS.has(period) && hour < 12) hour += 12;
    if (period === "中午" && hour < 11) hour += 12;
  }

  const base = shiftDays(startOfDay(now), offset ?? 0);
  let result = atTime(base, hour, minute);
  if (offset === null && result.getTime() <= now.getTime()) {
    result = atTime(shiftDays(base, 1), hour, minute);
  }
  return result;
}

function parseRelativeChinese(text: string, now: Date): Date | null {
  let dayOffset: number | null = null;
  let dayPeriod: string | undefined;
  for (const entry of DAY_WORDS) {
    if (text.includes(entry.word)) {
      dayOffset = entry.offset;
      dayPeriod = entry.period;
      break;
    }
  }

  let period: string | undefined = dayPeriod;
  if (!period) {
    for (const word of PERIOD_WORDS) {
      if (text.includes(word)) {
        period = word;
        break;
      }
    }
  }

  const clock = extractClock(text);
  if (dayOffset === null && !period && !clock) return null;

  let hour: number;
  let minute = 0;
  if (clock) {
    hour = clock.hour;
    minute = clock.minute;
  } else if (period) {
    hour = PERIOD_DEFAULT_HOUR[period] ?? DEFAULT_HOUR;
  } else {
    return null;
  }

  if (period) {
    if (PM_PERIODS.has(period)) {
      if (hour < 12) hour += 12;
      else if (hour === 12) hour = 0;
    }
    if (period === "中午" && hour < 11) hour += 12;
    if (period === "凌晨" && hour === 12) hour = 0;
  }

  const base = shiftDays(startOfDay(now), dayOffset ?? 0);
  let result = atTime(base, hour, minute);

  if (!period && dayOffset === null) {
    const pm = atTime(base, hour + 12, minute);
    if (result.getTime() <= now.getTime() && pm.getTime() > now.getTime() && hour < 12) {
      result = pm;
    }
  }
  if (dayOffset === null && result.getTime() <= now.getTime()) {
    result = atTime(shiftDays(base, 1), hour, minute);
  }

  return result;
}

export function resolveReminderTime(
  input: string,
  now: Date = new Date()
): ReminderTimeResolution {
  const text = (input ?? "").trim();
  if (!text) return { ok: false, error: "提醒时间为空" };

  const absolute = parseAbsolute(text, now);
  if (absolute) return { ok: true, at: absolute };

  const duration = parseDuration(text, now);
  if (duration) return { ok: true, at: duration };

  const weekday = parseWeekday(text, now);
  if (weekday) return { ok: true, at: weekday };

  const english = parseRelativeEnglish(text, now);
  if (english) return { ok: true, at: english };

  const chinese = parseRelativeChinese(text, now);
  if (chinese) return { ok: true, at: chinese };

  return {
    ok: false,
    error: `无法识别提醒时间「${text}」，请换成「明天下午3点」「30分钟后」「2026-11-19 15:30」这类写法`,
  };
}

export function dayDiff(from: Date, to: Date): number {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / DAY_MS);
}

export function formatReminderLabel(at: Date, now: Date = new Date()): string {
  if (Number.isNaN(at.getTime())) return "";
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const diff = dayDiff(now, at);
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `明天 ${time}`;
  if (diff === -1) return `昨天 ${time}`;
  if (diff > 1 && diff < 7) return `${diff} 天后 ${time}`;
  return `${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
}

export function formatLocalDateTime(at: Date | null): string {
  if (!at || Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(
    at.getHours()
  )}:${pad2(at.getMinutes())}`;
}

export function toDateTimeLocalValue(at: Date | null): string {
  if (!at || Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(
    at.getHours()
  )}:${pad2(at.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): Date | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
