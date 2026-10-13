interface LevelMeterProps {
  /** 0..1 */
  level: number;
  label: string;
}

export function LevelMeter({ level, label }: LevelMeterProps) {
  const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div
      className="level-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="level-meter__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
