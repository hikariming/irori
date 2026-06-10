const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", { weekday: "long" });

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function chineseHour(value: number): string {
  const labels = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  if (value <= 12) {
    return labels[value] ?? String(value);
  }
  return String(value);
}

export function formatTimeAtmosphere(date: Date): string {
  const hour = date.getHours();
  const minute = date.getMinutes();

  if (hour < 5) {
    if (hour === 0 && minute < 30) {
      return "刚过零点没多久。";
    }
    const displayHour = minute >= 40 ? hour + 1 : hour;
    return `都快凌晨${chineseHour(displayHour)}点了。`;
  }
  if (hour < 9) {
    return "早上刚铺开。";
  }
  if (hour < 12) {
    return "上午还在往前走。";
  }
  if (hour < 14) {
    return "正是中午前后。";
  }
  if (hour < 18) {
    return "下午的时间还算完整。";
  }
  if (hour < 22) {
    return "已经到晚上了。";
  }
  return "夜已经深了。";
}

export function buildCharacterTimeContext(date: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
  const localTime = [
    `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
    weekdayFormatter.format(date),
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  ].join(" ");

  return [
    `系统记录的本地时间：${localTime}`,
    `时区：${timeZone}`,
    `时间氛围：${formatTimeAtmosphere(date)}`,
    "请以系统记录的真实时间为准，不要依赖用户自己声称的时间。"
  ].join("\n");
}
