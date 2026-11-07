// Published schedules describe planned opening times, never live availability.
// Evaluate an instant in the provider's local calendar; no guessed UTC offset.
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const validScheduleDate = value => typeof value === 'string' && datePattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const validScheduleTime = value => typeof value === 'string' && timePattern.test(value);
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const intervalValid = interval => plainObject(interval)
  && Object.keys(interval).every(key => ['opens', 'closes', 'endsNextDay', 'days'].includes(key))
  && validScheduleTime(interval.opens) && validScheduleTime(interval.closes)
  && (interval.endsNextDay == null || typeof interval.endsNextDay === 'boolean')
  && (interval.endsNextDay === true ? minutes(interval.closes) <= minutes(interval.opens) : minutes(interval.closes) > minutes(interval.opens));

export function validateSchedule(schedule) {
  if (!plainObject(schedule) || Object.keys(schedule).some(key => !['timeZone', 'weekly', 'exceptions', 'validFrom', 'validThrough', 'text', 'complete'].includes(key))) return 'A schedule needs a supported structured contract.';
  if (schedule.complete != null && typeof schedule.complete !== 'boolean') return 'Schedule completeness must be explicit.';
  if (typeof schedule.timeZone !== 'string' || !(schedule.timeZone.includes('/') || schedule.timeZone === 'UTC')) return 'A schedule needs an explicit IANA local time zone.';
  try { new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }).format(0); } catch { return 'The schedule time zone is invalid.'; }
  if (!Array.isArray(schedule.weekly) || !schedule.weekly.length || schedule.weekly.length > 28) return 'A schedule needs 1–28 weekly intervals.';
  if (schedule.weekly.some(interval => !intervalValid(interval) || !Array.isArray(interval.days) || !interval.days.length || interval.days.length > 7 || new Set(interval.days).size !== interval.days.length || interval.days.some(day => !Number.isInteger(day) || day < 0 || day > 6))) return 'Schedule intervals need valid weekdays and explicit overnight times.';
  if (schedule.text != null && (typeof schedule.text !== 'string' || !schedule.text.trim() || schedule.text.length > 1600 || /[\u0000-\u001f\u007f]/.test(schedule.text))) return 'Schedule text must be bounded plain text.';
  for (const key of ['validFrom', 'validThrough']) if (schedule[key] != null && !validScheduleDate(schedule[key])) return 'Schedule validity needs real local dates.';
  if (schedule.validFrom && schedule.validThrough && schedule.validThrough < schedule.validFrom) return 'Schedule validity dates are reversed.';
  if (schedule.exceptions != null) {
    if (!Array.isArray(schedule.exceptions) || schedule.exceptions.length > 100) return 'Schedule exceptions must be a bounded list.';
    const dates = new Set();
    for (const exception of schedule.exceptions) {
      if (!plainObject(exception) || Object.keys(exception).some(key => !['date', 'closed', 'intervals', 'note'].includes(key)) || !validScheduleDate(exception.date) || dates.has(exception.date)) return 'Schedule exceptions need unique real local dates.';
      dates.add(exception.date);
      if (exception.note != null && (typeof exception.note !== 'string' || !exception.note.trim() || exception.note.length > 400 || /[\u0000-\u001f\u007f]/.test(exception.note))) return 'Schedule exception notes must be bounded plain text.';
      if (exception.closed === true) { if (exception.intervals != null) return 'A closed date cannot also publish opening intervals.'; }
      else if ((exception.closed != null && exception.closed !== false) || !Array.isArray(exception.intervals) || !exception.intervals.length || exception.intervals.length > 8 || exception.intervals.some(interval => !intervalValid(interval) || interval.days != null)) return 'An exception needs an explicit closure or valid replacement intervals.';
    }
  }
  return null;
}

const calendarDate = date => date.toISOString().slice(0, 10);
const previousDate = date => calendarDate(new Date(Date.parse(date) - 86400000));
const weekday = date => new Date(date).getUTCDay();
const isPublishedDate = (schedule, date) => (!schedule.validFrom || date >= schedule.validFrom) && (!schedule.validThrough || date <= schedule.validThrough);
function intervalsFor(schedule, date) {
  if (!isPublishedDate(schedule, date)) return [];
  const exception = schedule.exceptions?.find(item => item.date === date);
  return exception ? (exception.closed ? [] : exception.intervals) : schedule.weekly.filter(interval => interval.days.includes(weekday(date)));
}

export function evaluateSchedule(schedule, { now = new Date(), verified = false } = {}) {
  const unknown = { state: 'unknown', availability: 'unconfirmed' };
  if (!verified || validateSchedule(schedule) || !(now instanceof Date) || !Number.isFinite(now.getTime())) return unknown;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (!isPublishedDate(schedule, date)) return unknown;
  const time = Number(parts.hour) * 60 + Number(parts.minute);
  const exception = schedule.exceptions?.find(item => item.date === date);
  const current = intervalsFor(schedule, date).some(interval => time >= minutes(interval.opens) && (interval.endsNextDay === true || time < minutes(interval.closes)));
  // A dated exception replaces that local calendar day, including carry-over.
  const overnight = !exception && intervalsFor(schedule, previousDate(date)).some(interval => interval.endsNextDay === true && time < minutes(interval.closes));
  if (!current && !overnight && !exception && schedule.complete !== true) return unknown;
  return { state: current || overnight ? 'scheduled-open' : 'scheduled-closed', availability: 'unconfirmed', localDate: date, timeZone: schedule.timeZone };
}

export function scheduleText(schedule, { locale = 'en', nextDay = 'next day', exceptions = 'Schedule exceptions', season = 'Published dates' } = {}) {
  if (validateSchedule(schedule)) return '';
  const language = locale === 'es' ? 'es' : 'en';
  const day = number => new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + number)));
  const clock = value => new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`2026-01-04T${value}:00Z`));
  const interval = item => `${clock(item.opens)}–${clock(item.closes)}${item.endsNextDay ? ` (${nextDay})` : ''}`;
  return [schedule.text, ...schedule.weekly.map(item => `${item.days.map(day).join(', ')} ${interval(item)}`), schedule.timeZone,
    schedule.validFrom || schedule.validThrough ? `${season}: ${schedule.validFrom || '…'}–${schedule.validThrough || '…'}` : '',
    schedule.exceptions?.length ? `${exceptions}: ${schedule.exceptions.map(item => `${item.date}: ${item.closed ? (language === 'es' ? 'cerrado' : 'closed') : item.intervals.map(interval).join(', ')}${item.note ? ` (${item.note})` : ''}`).join('; ')}` : ''
  ].filter(Boolean).join('. ');
}
