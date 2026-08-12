import { addDays, format, parseISO, setHours, setMinutes } from "date-fns";
import type { Config } from "./types";

const FRIDAY = 5;
const SATURDAY = 6;

/** Local calendar day key (yyyy-MM-dd). Prefer this over `toISOString().slice(0, 10)` (UTC). */
export const dateKey = (date: Date) => format(date, "yyyy-MM-dd");

/** Parse a yyyy-MM-dd config value as local midnight (not UTC). */
export const parseCalendarDate = (value: string) => parseISO(value);

export const todayDateKey = () => dateKey(new Date());

export const effectiveHoursPerDay = (config: Config) => Math.max(1, config.hoursPerDay || 6);

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const workdayStartHour = (config: Config) =>
  Math.max(0, Math.min(23, config.workdayStartHour ?? 11));

export const toWorkdayStart = (date: Date, config: Config) =>
  setMinutes(setHours(date, workdayStartHour(config)), 0);

export const toWorkdayEnd = (date: Date, config: Config) =>
  setMinutes(setHours(date, workdayStartHour(config) + effectiveHoursPerDay(config)), 0);

export const getScheduleEpoch = (config: Config): Date => {
  const raw = config.replanAsOf?.trim();
  if (raw) {
    const parsed = parseISO(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return nextWorkingStart(parsed, config);
    }
  }
  return nextWorkingStart(parseISO(config.sprintStartDate), config);
};

/** Planning is biweekly from `planningSunday` (anchor date), not every Sunday. */
const isPlanningCycleSunday = (date: Date, config: Config): boolean => {
  const anchor = parseISO(config.planningSunday);
  if (Number.isNaN(anchor.getTime())) return false;
  const anchorStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((dateStart.getTime() - anchorStart.getTime()) / MS_IN_DAY);
  return dayDiff >= 0 && dayDiff % 14 === 0;
};

export const isNonWorkingDay = (date: Date, config: Config): boolean => {
  const day = date.getDay();
  if (day === FRIDAY || day === SATURDAY) {
    return true;
  }
  if (isPlanningCycleSunday(date, config)) {
    return true;
  }

  return config.extraHolidays.includes(dateKey(date));
};

export const isSprintCalendarSlotDay = (date: Date, config: Config): boolean => {
  void config;
  const day = date.getDay();
  if (day === FRIDAY || day === SATURDAY) {
    return false;
  }
  return true;
};

export const nextWorkingStart = (date: Date, config: Config): Date => {
  let current = new Date(date);
  while (isNonWorkingDay(current, config)) {
    current = toWorkdayStart(addDays(current, 1), config);
  }

  const dayStart = toWorkdayStart(current, config);
  const dayEnd = toWorkdayEnd(current, config);
  if (current < dayStart) {
    return dayStart;
  }
  if (current >= dayEnd) {
    return nextWorkingStart(toWorkdayStart(addDays(current, 1), config), config);
  }
  return current;
};

/** Start of the next calendar day's work window (skips non-working days). */
const nextDayWorkingStart = (date: Date, config: Config): Date =>
  nextWorkingStart(toWorkdayStart(addDays(toWorkdayStart(date, config), 1), config), config);

export const advanceByWorkingHours = (start: Date, hours: number, config: Config): Date => {
  if (hours <= 0) {
    return start;
  }

  let remaining = hours;
  let cursor = nextWorkingStart(start, config);

  while (remaining > 0) {
    if (isNonWorkingDay(cursor, config)) {
      cursor = nextDayWorkingStart(cursor, config);
      continue;
    }

    const dayStart = toWorkdayStart(cursor, config);
    const dayEnd = toWorkdayEnd(cursor, config);
    if (cursor < dayStart) {
      cursor = dayStart;
    }

    const hoursLeftToday = Math.max(0, (dayEnd.getTime() - cursor.getTime()) / (1000 * 60 * 60));
    if (hoursLeftToday <= 0) {
      cursor = nextDayWorkingStart(cursor, config);
      continue;
    }

    const spend = Math.min(hoursLeftToday, remaining);
    cursor = new Date(cursor.getTime() + spend * 60 * 60 * 1000);
    remaining -= spend;

    if (remaining > 0) {
      // Move to the next day's workday start — not addDays(endOfDay), which skips a day.
      cursor = nextDayWorkingStart(cursor, config);
    }
  }

  return cursor;
};

export const addWorkingDays = (start: Date, days: number, config: Config): Date => {
  if (days <= 0) {
    return toWorkdayEnd(nextWorkingStart(start, config), config);
  }
  let cursor = nextWorkingStart(start, config);
  let left = days - 1;
  while (left > 0) {
    cursor = addDays(cursor, 1);
    if (!isNonWorkingDay(cursor, config)) {
      left -= 1;
    }
  }
  return toWorkdayEnd(cursor, config);
};

export const getSprintSlotCalendarDays = (config: Config): Date[] => {
  const targetSlots = Math.max(1, config.sprintWorkingDays || 10);
  const slots: Date[] = [];
  let cursor = parseISO(config.sprintStartDate);
  let guard = 0;
  while (slots.length < targetSlots && guard < 400) {
    if (isSprintCalendarSlotDay(cursor, config)) {
      slots.push(new Date(cursor));
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return slots;
};

export const getSprintWorkingDayCountInWindow = (config: Config): number =>
  Math.max(1, getSprintSlotCalendarDays(config).filter((d) => !isNonWorkingDay(d, config)).length);

export const totalWorkingHoursForSprint = (config: Config): number =>
  Math.max(1, effectiveHoursPerDay(config) * getSprintWorkingDayCountInWindow(config));

export const getSprintWindowEnd = (config: Config): Date => {
  const slots = getSprintSlotCalendarDays(config);
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (!isNonWorkingDay(slots[i], config)) {
      return toWorkdayEnd(slots[i], config);
    }
  }
  return toWorkdayEnd(nextWorkingStart(parseISO(config.sprintStartDate), config), config);
};

export const shiftIfPlanningSunday = (date: Date, config: Config): Date => {
  if (!isPlanningCycleSunday(date, config)) {
    return date;
  }
  return nextWorkingStart(addDays(date, 1), config);
};

/** True when `date` falls in the final hour of that day's work window (or at day end). */
export const isInLastWorkdayHour = (date: Date, config: Config): boolean => {
  const dayEnd = toWorkdayEnd(date, config);
  const lastHourStart = new Date(dayEnd.getTime() - 60 * 60 * 1000);
  return date.getTime() >= lastHourStart.getTime();
};

/**
 * UAT ready time after QC (+ buffer). If that lands in the last workday hour,
 * UAT opens at the first hour of the next working day.
 */
export const resolveUatReleaseDate = (readyAt: Date, config: Config): Date => {
  let uat = shiftIfPlanningSunday(readyAt, config);
  if (isInLastWorkdayHour(uat, config)) {
    uat = nextDayWorkingStart(uat, config);
    uat = shiftIfPlanningSunday(uat, config);
  }
  return uat;
};

export const getNextBusinessDayFrom = (date: Date, config: Config): Date => {
  const candidate = addDays(date, 1);
  const atSameTime = new Date(candidate);
  while (isNonWorkingDay(atSameTime, config)) {
    atSameTime.setDate(atSameTime.getDate() + 1);
  }
  return shiftIfPlanningSunday(atSameTime, config);
};

export const getProductionReleaseDateFrom = (uatReleaseDate: Date, config: Config): Date => {
  const cutoffHour = 16;
  const nextDayReleaseHour = 10;
  const nextBusinessDay = getNextBusinessDayFrom(uatReleaseDate, config);
  let productionRelease = setMinutes(
    setHours(nextBusinessDay, uatReleaseDate.getHours()),
    uatReleaseDate.getMinutes(),
  );

  const isAfterCutoff =
    productionRelease.getHours() > cutoffHour ||
    (productionRelease.getHours() === cutoffHour &&
      (productionRelease.getMinutes() > 0 ||
        productionRelease.getSeconds() > 0 ||
        productionRelease.getMilliseconds() > 0));

  if (isAfterCutoff) {
    const dayAfterProduction = getNextBusinessDayFrom(productionRelease, config);
    productionRelease = setMinutes(setHours(dayAfterProduction, nextDayReleaseHour), 0);
  }

  return productionRelease;
};
