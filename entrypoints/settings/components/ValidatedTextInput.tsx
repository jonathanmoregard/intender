import type React from 'react';
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

export type ValidationResult = { ok: true } | { ok: false; reason?: string };

export interface ValidatedTextInputProps {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder: string;
  className: string; // should include stable selectors like 'url-input'
  validate: (input: string) => ValidationResult;
  errorText?: string;
  showCheckmarkOnValid?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  validationVisibility?: 'blur' | 'always' | 'hidden';
}

export type ValidatedTextInputHandle = {
  showValidity: () => void;
};

export const ValidatedTextInput = forwardRef<
  ValidatedTextInputHandle,
  ValidatedTextInputProps
>(function ValidatedTextInputInner(props, ref) {
  const {
    value,
    onChange,
    label,
    placeholder,
    className,
    validate,
    errorText,
    showCheckmarkOnValid,
    onKeyDown,
    inputRef,
    id,
    name,
    disabled,
    required,
    autoComplete,
    inputMode,
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
  const showValid = shouldShow && isValid;

  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const errorId = `${inputId}-error`;

  const computedClassName = [
    className,
    showError ? 'error' : '',
    showValid ? 'parseable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className='input-group'>
      <input
        ref={el => inputRef && inputRef(el)}
        type='text'
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
        id={inputId}
        name={name}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={showError ? true : false}
        aria-describedby={showError ? errorId : undefined}
      />
      <label className='input-label' htmlFor={inputId}>
        {label}
      </label>
      {showValid && showCheckmarkOnValid ? (
        <span className='valid-checkmark'>✓</span>
      ) : null}
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
