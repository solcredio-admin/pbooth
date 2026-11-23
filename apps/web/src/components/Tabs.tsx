"use client";
// A row of tab buttons; the panes are the caller's (shown with `hidden`, so forms keep every field).
export function Tabs<T extends string>({ tabs, value, onChange, errors = [], label }: {
  tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; errors?: T[]; label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={errors.includes(t.id) ? "has-err" : undefined}
          onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}
