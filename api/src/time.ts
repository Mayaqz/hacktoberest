import { env } from "./config.ts";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: env.TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const parts = (date: Date) => {
  const map = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: Number(map.hour) * 60 + Number(map.minute),
    time: `${map.hour}:${map.minute}`,
  };
};

/** School-day key "YYYY-MM-DD" in the school's time zone. */
export const today = (now = new Date()) => parts(now).date;

/** Local "HH:mm" in the school's time zone. */
export const localTime = (date: Date) => parts(date).time;

/** Minutes since local midnight. */
export const localMinutes = (now = new Date()) => parts(now).minutes;

export const parseHHmm = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 24 * 60 ? minutes : null;
};

/** "10-р сарын 24, 18:00" style label for SMS and calls. */
export const mongolianDateTime = (date: Date) => {
  const p = parts(date);
  const [, month, day] = p.date.split("-").map(Number);
  return `${month}-р сарын ${day}, ${p.time}`;
};
