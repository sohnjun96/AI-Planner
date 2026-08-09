const MINUTE_STEP = 5;

const HOUR_OPTIONS_24 = Array.from({ length: 24 }, (_, index) => index);
const HOUR_OPTIONS_12 = Array.from({ length: 12 }, (_, index) => index + 1);
const MINUTE_OPTIONS = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);

interface TimeSelectProps {
  name: string;
  value: string;
  timeFormat: "24h" | "12h";
  labelId: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}

interface ParsedTime {
  hour: number;
  minute: number;
}

function padTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseTime(value: string): ParsedTime | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return undefined;
  }

  return { hour, minute };
}

function formatTime(hour: number, minute: number): string {
  return `${padTimePart(hour)}:${padTimePart(minute)}`;
}

export function TimeSelect({
  name,
  value,
  timeFormat,
  labelId,
  required = false,
  invalid = false,
  describedBy,
  onChange,
}: TimeSelectProps) {
  const parsed = parseTime(value);
  const isTwelveHour = timeFormat === "12h";
  const period = parsed ? (parsed.hour >= 12 ? "pm" : "am") : "";
  const displayedHour = parsed ? (isTwelveHour ? parsed.hour % 12 || 12 : parsed.hour) : "";
  const displayedMinute = parsed?.minute ?? "";
  const minuteOptions =
    parsed && parsed.minute % MINUTE_STEP !== 0
      ? [...MINUTE_OPTIONS, parsed.minute].sort((left, right) => left - right)
      : MINUTE_OPTIONS;

  function updateHour(nextDisplayedHour: number) {
    const minute = parsed?.minute ?? 0;
    if (!isTwelveHour) {
      onChange(formatTime(nextDisplayedHour, minute));
      return;
    }

    const nextPeriod = period || "am";
    const normalizedHour = nextDisplayedHour % 12 + (nextPeriod === "pm" ? 12 : 0);
    onChange(formatTime(normalizedHour, minute));
  }

  function updatePeriod(nextPeriod: "am" | "pm") {
    const baseHour = parsed?.hour ?? 9;
    const normalizedHour = baseHour % 12 + (nextPeriod === "pm" ? 12 : 0);
    onChange(formatTime(normalizedHour, parsed?.minute ?? 0));
  }

  function updateMinute(nextMinute: number) {
    onChange(formatTime(parsed?.hour ?? 9, nextMinute));
  }

  const sharedAriaProps = {
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required ? true : undefined,
  };

  return (
    <div
      className={`task-time-select${invalid ? " is-invalid" : ""}`}
      role="group"
      aria-labelledby={labelId}
    >
      {isTwelveHour ? (
        <label className="task-time-select-part task-time-select-period">
          <select
            value={period}
            onChange={(event) => updatePeriod(event.target.value as "am" | "pm")}
            aria-label="오전 또는 오후"
            {...sharedAriaProps}
          >
            <option value="" disabled>
              선택
            </option>
            <option value="am">오전</option>
            <option value="pm">오후</option>
          </select>
        </label>
      ) : null}

      <label className="task-time-select-part">
        <select
          name={name}
          value={displayedHour}
          onChange={(event) => updateHour(Number(event.target.value))}
          required={required}
          aria-label="시"
          {...sharedAriaProps}
        >
          <option value="" disabled>
            시
          </option>
          {(isTwelveHour ? HOUR_OPTIONS_12 : HOUR_OPTIONS_24).map((hour) => (
            <option key={hour} value={hour}>
              {padTimePart(hour)}
            </option>
          ))}
        </select>
      </label>

      <span className="task-time-select-divider" aria-hidden="true">
        :
      </span>

      <label className="task-time-select-part">
        <select
          value={displayedMinute}
          onChange={(event) => updateMinute(Number(event.target.value))}
          required={required}
          aria-label="분, 5분 단위"
          {...sharedAriaProps}
        >
          <option value="" disabled>
            분
          </option>
          {minuteOptions.map((minute) => (
            <option key={minute} value={minute}>
              {padTimePart(minute)}{minute % MINUTE_STEP !== 0 ? " (기존 값)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
