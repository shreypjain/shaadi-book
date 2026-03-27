"use client";

/**
 * OTPInput — six single-digit boxes with auto-advance and auto-submit.
 *
 * Behaviour:
 *  - Typing a digit moves focus to the next box.
 *  - Backspace on an empty box moves focus to the previous box.
 *  - Pasting a 6-digit string fills all boxes instantly.
 *  - When all 6 boxes are filled, onComplete is called with the code string.
 *  - Disabled while loading / submitted.
 */

import { useRef, useCallback } from "react";

const OTP_LENGTH = 6;

interface OTPInputProps {
  value: string; // controlled: string of up to 6 digits
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  error?: string;
}

export function OTPInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  error,
}: OTPInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>(
    Array(OTP_LENGTH).fill(null)
  );

  // Focus a specific box by index
  const focusBox = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, OTP_LENGTH - 1));
    inputRefs.current[clamped]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === "Backspace") {
        if (value[index]) {
          // Clear current box
          const next = value.split("");
          next[index] = "";
          onChange(next.join(""));
        } else {
          // Move to previous box
          focusBox(index - 1);
        }
      } else if (e.key === "ArrowLeft") {
        focusBox(index - 1);
      } else if (e.key === "ArrowRight") {
        focusBox(index + 1);
      }
    },
    [value, onChange, focusBox]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
      const raw = e.target.value.replace(/\D/g, "");
      if (!raw) return;

      // Handle paste of multiple digits
      if (raw.length > 1) {
        const filled = raw.slice(0, OTP_LENGTH);
        const padded = filled.padEnd(OTP_LENGTH, " ").slice(0, OTP_LENGTH);
        // Build from current value, overwriting from index
        const chars = value.split("").concat(Array(OTP_LENGTH).fill(""));
        for (let i = 0; i < filled.length && index + i < OTP_LENGTH; i++) {
          chars[index + i] = filled[i] ?? "";
        }
        const next = chars.slice(0, OTP_LENGTH).join("").replace(/ /g, "").slice(0, OTP_LENGTH);
        onChange(next);
        const nextFocus = Math.min(index + filled.length, OTP_LENGTH - 1);
        focusBox(nextFocus);
        if (next.length === OTP_LENGTH) {
          onComplete(next);
        }
        return;
      }

      // Single digit
      const digit = raw[0]!;
      const chars = (value + "      ").slice(0, OTP_LENGTH).split("");
      chars[index] = digit;
      const next = chars.join("").trimEnd().slice(0, OTP_LENGTH);
      onChange(next);

      if (index < OTP_LENGTH - 1) {
        focusBox(index + 1);
      }

      // Check if complete
      const full = chars.join("").replace(/ /g, "");
      if (full.length === OTP_LENGTH) {
        onComplete(chars.join("").trim());
      }
    },
    [value, onChange, onComplete, focusBox]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
      if (!pasted) return;

      const chars = Array(OTP_LENGTH).fill("");
      for (let i = 0; i < pasted.length; i++) {
        chars[i] = pasted[i] ?? "";
      }
      const next = chars.join("");
      onChange(next);
      focusBox(Math.min(pasted.length, OTP_LENGTH - 1));
      if (next.replace(/ /g, "").length === OTP_LENGTH) {
        onComplete(next);
      }
    },
    [onChange, onComplete, focusBox]
  );

  // Focus on click to first empty or clicked box
  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.select();
    },
    []
  );

  return (
    <div className="flex flex-col gap-2 items-center">
      <div className="flex gap-2.5" role="group" aria-label="One-time passcode">
        {Array.from({ length: OTP_LENGTH }, (_, i) => {
          const digit = value[i] ?? "";
          const isFilled = digit !== "" && digit !== " ";
          const isActive = !disabled;

          return (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={isFilled ? digit : ""}
              onChange={(e) => handleChange(e, i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              onPaste={(e) => handlePaste(e, i)}
              onFocus={handleFocus}
              disabled={disabled}
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              className={`
                w-12 h-14 text-center text-xl font-bold rounded-2xl border-2 
                transition-all duration-150 bg-white
                focus:outline-none
                ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                ${error
                  ? "border-red-400 text-red-600 bg-red-50"
                  : isFilled
                  ? "border-brand-400 text-brand-700 bg-brand-50"
                  : isActive
                  ? "border-gray-200 text-gray-800 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                  : "border-gray-200 text-gray-800"
                }
              `}
            />
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-red-500 text-center" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
