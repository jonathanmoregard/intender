import {
  forwardRef,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import type React from 'react';

export type ValidationResult = { ok: true } | { ok: false; reason?: string };

export interface ValidatedTextAreaProps {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder: string;
  className: string; // should include stable selectors like 'phrase-input'
  validate: (input: string) => ValidationResult;
  errorText?: string;
  rows?: number;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  autoComplete?: string;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  validationVisibility?: 'blur' | 'always' | 'hidden';
}

export type ValidatedTextAreaHandle = {
  showValidity: () => void;
};

export const ValidatedTextArea = forwardRef<
  ValidatedTextAreaHandle,
  ValidatedTextAreaProps
>(function ValidatedTextAreaInner(props, ref) {
  const {
    value,
    onChange,
    label,
    placeholder,
    className,
    validate,
    errorText,
    rows,
    maxLength,
    onKeyDown,
    id,
    name,
    disabled,
    required,
    autoComplete,
    onFocus,
    onBlur,
    validationVisibility,
  } = props;

  const [blurred, setBlurred] = useState<boolean>(false);
  const [forceShow, setForceShow] = useState<boolean>(false);

  useImperativeHandle(ref, () => ({
    showValidity() {
      setForceShow(true);
    },
  }));

  const validation = useMemo(() => validate(value), [validate, value]);

  const isValid = validation.ok === true;
  const visibilityMode = validationVisibility ?? 'blur';
  const shouldShow =
    visibilityMode === 'always'
      ? true
      : visibilityMode === 'hidden'
        ? false
        : blurred || forceShow;
  const showError = shouldShow && !isValid;

  const autoId = useId();
  const inputId = id ?? `textarea-${autoId}`;
  const errorId = `${inputId}-error`;

  const computedClassName = [className, showError ? 'error' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className='input-group'>
      <textarea
        className={computedClassName}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={e => {
          if (onFocus) onFocus(e);
        }}
        onBlur={e => {
          setBlurred(true);
          if (onBlur) onBlur(e);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        id={inputId}
        name={name}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={showError ? true : false}
        aria-describedby={showError ? errorId : undefined}
      />
      <label className='input-label' htmlFor={inputId}>
        {label}
      </label>
      {showError ? (
        <div
          id={errorId}
          className='error-text show'
          role='alert'
          aria-live='polite'
        >
          {errorText ?? validation.reason ?? ''}
        </div>
      ) : null}
    </div>
  );
});
