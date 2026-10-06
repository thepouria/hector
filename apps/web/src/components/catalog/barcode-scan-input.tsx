'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { normalizeScannerInput } from '@/lib/utils/scanner-input';

type BarcodeScanInputProps = {
  id?: string;
  onScan: (value: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Clear + refocus after a successful scan callback resolves. */
  clearOnSubmit?: boolean;
};

export type BarcodeScanInputHandle = {
  focus: () => void;
};

/**
 * Keyboard-wedge barcode scanner + manual entry.
 * Submits on Enter; ignores empty; guards against double-submit while resolving.
 * Does not mutate inventory — callers decide what to do with the value.
 */
export const BarcodeScanInput = React.forwardRef<BarcodeScanInputHandle, BarcodeScanInputProps>(
  function BarcodeScanInput(
    {
      id,
      onScan,
      disabled,
      placeholder = 'اسکن یا وارد کردن بارکد...',
      autoFocus = true,
      className,
      clearOnSubmit = true,
    },
    ref,
  ) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [value, setValue] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const submittingRef = React.useRef(false);

    React.useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    React.useEffect(() => {
      if (autoFocus) {
        inputRef.current?.focus();
      }
    }, [autoFocus]);

    const submit = React.useCallback(async () => {
      const trimmed = normalizeScannerInput(value);
      if (!trimmed || busy || submittingRef.current || disabled) return;
      submittingRef.current = true;
      setBusy(true);
      try {
        await onScan(trimmed);
        if (clearOnSubmit) {
          setValue('');
        }
      } finally {
        submittingRef.current = false;
        setBusy(false);
        if (clearOnSubmit) {
          queueMicrotask(() => inputRef.current?.focus());
        }
      }
    }, [value, busy, disabled, onScan, clearOnSubmit]);

    return (
      <Input
        id={id}
        ref={inputRef}
        dir="ltr"
        className={cn('font-mono text-left', className)}
        value={value}
        disabled={disabled || busy}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      />
    );
  },
);
