"use client";

/**
 * PhoneInput — country picker (US/IN) + formatted phone number input.
 *
 * The component formats display text while keeping raw digits in sync.
 * Validation is enforced before the parent can submit (10 local digits).
 *
 * Props:
 *   value     — raw digit string (no spaces / dashes), controlled
 *   country   — "US" | "IN"
 *   onChange  — called with (rawDigits, country) whenever either changes
 *   disabled  — disables both pickers
 *   error     — optional error message shown below the input
 */

import { useCallback, useMemo } from "react";

// ---------------------------------------------------------------------------
// Country metadata
// ---------------------------------------------------------------------------

const COUNTRIES = [
  {
    code: "US" as const,
    dial: "+1",
    label: "US +1",
    placeholder: "(555) 555-1234",
    maxDigits: 10,
  },
  {
    code: "IN" as const,
    dial: "+91",
    label: "IN +91",
    placeholder: "98765 43210",
    maxDigits: 10,
  },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUS(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatIN(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}

function formatPhone(digits: string, country: "US" | "IN"): string {
  return country === "US" ? formatUS(digits) : formatIN(digits);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidPhone(digits: string, country: "US" | "IN"): boolean {
  const clean = digits.replace(/\D/g, "");
  if (country === "US") return clean.length === 10;
  // IN: 10 digits, starting with 6-9
  return clean.length === 10 && /^[6-9]/.test(clean);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PhoneInputProps {
  value: string;
  country: "US" | "IN";
  onChange: (rawDigits: string, country: "US" | "IN") => void;
  disabled?: boolean;
  error?: string;
}

export function PhoneInput({
  value,
  country,
  onChange,
  disabled = false,
  error,
}: PhoneInputProps) {
  const meta = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0]!;

  const displayValue = useMemo(
    () => formatPhone(value, country),
    [value, country]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D/g, "").slice(0, meta.maxDigits);
      onChange(raw, country);
    },
    [country, meta.maxDigits, onChange]
  );

  const handleCountryChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value as "US" | "IN";
      onChange("", next); // reset phone when country changes
    },
    [onChange]
  );

  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex items-center rounded-lg border bg-white overflow-hidden
          transition-colors
          ${hasError ? "border-[#dc2626] ring-1 ring-[#dc2626]" : "border-[#e8e4df] focus-within:border-[#1e3a5f] focus-within:ring-1 focus-within:ring-[#1e3a5f]"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {/* Country selector */}
        <div className="relative flex-shrink-0">
          <select
            value={country}
            onChange={handleCountryChange}
            disabled={disabled}
            aria-label="Select country"
            className="appearance-none bg-cream-100 border-r border-[#e8e4df] pl-3 pr-7 py-3.5
                       text-sm font-medium text-[#1a1a2e] cursor-pointer
                       focus:outline-none focus:bg-cream-200
                       disabled:cursor-not-allowed"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          {/* Chevron icon */}
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <svg
              className="w-3 h-3 text-[#8a8a9a]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        {/* Phone input */}
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={displayValue}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder={meta.placeholder}
          aria-label="Phone number"
          aria-invalid={hasError}
          className="flex-1 px-4 py-3.5 text-sm bg-transparent focus:outline-none
                     placeholder:text-[#c8c8d0] text-[#1a1a2e]
                     disabled:cursor-not-allowed"
        />
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-[#dc2626] px-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
