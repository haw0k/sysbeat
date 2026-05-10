import * as React from 'react';
import { cn } from '@/lib/utils';

interface ISelectOption {
  value: string;
  label: string;
}

interface ISelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  options: ISelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
}

const Select = React.forwardRef<HTMLSelectElement, ISelectProps>(
  ({ value, onValueChange, placeholder, options, disabled, ariaLabel }, ref) => {
    return (
      <select
        ref={ref}
        value={value ?? ''}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onValueChange?.(e.target.value)}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          '[&>option]:bg-background'
        )}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
);
Select.displayName = 'Select';

export { Select };
export type { ISelectOption };
