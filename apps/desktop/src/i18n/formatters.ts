import { getCurrentLanguage } from "./index";

// 统一的日期/时间格式化：locale 跟随当前界面语言。Intl 原生支持 zh-CN/en/ja/ko，
// 所以不需要 dayjs 之类的库。注意：在创建时就格式化并存进对象的字段（如消息时间戳），
// 切换语言不会回溯重排，只有之后新生成的才用新语言——这对聊天时间戳是可接受的。

// 时:分（24 小时制），用于聊天气泡、调试时间、会话列表等。
export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat(getCurrentLanguage(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

// 「x月x日」这类较口语的月日，用于动态、信物等。
export function formatMonthDayLong(date: Date): string {
  return new Intl.DateTimeFormat(getCurrentLanguage(), {
    month: "long",
    day: "numeric"
  }).format(date);
}

// 紧凑月日，用于会话列表里的较早日期。
export function formatMonthDayNumeric(date: Date): string {
  return new Intl.DateTimeFormat(getCurrentLanguage(), {
    month: "numeric",
    day: "numeric"
  }).format(date);
}
