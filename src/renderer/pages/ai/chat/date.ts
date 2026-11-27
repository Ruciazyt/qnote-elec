import { format } from "date-fns";

export function getTimestampLabel(date: Date): string {
  const now = new Date();
  const value = new Date(date);
  const today = format(now, "yyyy-MM-dd");
  const dateText = format(value, "yyyy-MM-dd");

  if (dateText === today) return `今天 ${format(value, "HH:mm")}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dateText === format(yesterday, "yyyy-MM-dd")) {
    return `昨天 ${format(value, "HH:mm")}`;
  }

  const diffDays = Math.floor(
    (now.getTime() - value.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 7) {
    const weekdays = "周日周一周二周三周四周五周六".split("");
    return `${weekdays[value.getDay()]} ${format(value, "HH:mm")}`;
  }
  return format(value, "MM-dd HH:mm");
}
