import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'
> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

/** Keep an unfinished sign/decimal in the input instead of coercing it to zero. */
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  onBlur,
  onKeyDown,
  ...props
}: Props) {
  const [draft, setDraft] = useState(String(value));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDraft(String(value));
    }
  }, [value]);
  const commit = (number: number) => {
    emitted.current = number;
    onValueChange(number);
  };
  const complete = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      value={draft}
      onChange={(event) => {
        const text = event.target.value.replace('−', '-');
        if (!/^-?\d*(?:\.\d*)?$/.test(text)) return;
        setDraft(text);
        if (complete.test(text) && Number.isFinite(Number(text))) commit(Number(text));
      }}
      onBlur={(event) => {
        if (
          draft.trim() &&
          !['-', '.', '-.'].includes(draft) &&
          Number.isFinite(Number(draft))
        ) {
          commit(Number(draft));
          setDraft(String(Number(draft)));
        } else setDraft(String(value));
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const base = complete.test(draft) ? Number(draft) : value;
          const next = Math.min(
            max ?? Infinity,
            Math.max(
              min ?? -Infinity,
              Number((base + (event.key === 'ArrowUp' ? step : -step)).toFixed(10)),
            ),
          );
          setDraft(String(next));
          commit(next);
        }
        if (event.key === 'Escape') {
          setDraft(String(value));
          event.stopPropagation();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
