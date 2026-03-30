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

  const focusBox = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, OTP_LENGTH - 1));
    inputRefs.current[clamped]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === "Backspace") {
        if (value[index]) {
          const next = value.split("");
          next[index] = "";
          onChange(next.join(""));
        } else {
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

      if (raw.length > 1) {
        // Full-length code (paste / SMS autofill) → always fill from box 0
        const startIndex = raw.length >= OTP_LENGTH ? 0 : index;
        const filled = raw.slice(0, OTP_LENGTH);
        const chars = value.split("").concat(Array(OTP_LENGTH).fill(""));
        for (let i = 0; i < filled.length && startIndex + i < OTP_LENGTH; i++) {
          chars[startIndex + i] = filled[i] ?? "";
        }
        const next = chars.slice(0, OTP_LENGTH).join("").replace(/ /g, "").slice(0, OTP_LENGTH);
        onChange(next);
        const nextFocus = Math.min(startIndex + filled.length, OTP_LENGTH - 1);
        focusBox(nextFocus);
        if (next.length === OTP_LENGTH) onComplete(next);
        return;
      }

      const digit = raw[0]!;
      const chars = (value + "      ").slice(0, OTP_LENGTH).split("");
      chars[index] = digit;
      const next = chars.join("").trimEnd().slice(0, OTP_LENGTH);
      onChange(next);

      if (index < OTP_LENGTH - 1) focusBox(index + 1);

      const full = chars.join("").replace(/ /g, "");
      if (full.length === OTP_LENGTH) onComplete(chars.join("").trim());
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
      if (next.replace(/ /g, "").length === OTP_LENGTH) onComplete(next);
    },
    [onChange, onComplete, focusBox]
  );

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  }, []);

  return (
    <div className="flex flex-col gap-2 items-center">
      <div className="flex gap-2" role="group" aria-label="One-time passcode">
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
              value={isFilled ? digit : ""}
              onChange={(e) => handleChange(e, i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              onPaste={(e) => handlePaste(e, i)}
              onFocus={handleFocus}
              disabled={disabled}
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              className={`
                w-11 h-12 text-center text-xl font-bold rounded-lg border-2
                transition-all duration-150 bg-white
                focus:outline-none
                ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                ${error
                  ? "border-[#dc2626] text-[#dc2626] bg-red-50"
                  : isFilled
                  ? "border-[#1e3a5f] text-[#1e3a5f] bg-[#eef4f9]"
                  : isActive
                  ? "border-[rgba(184,134,11,0.12)] text-charcoal focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#d4e3f0]"
                  : "border-[rgba(184,134,11,0.12)] text-charcoal"
                }
              `}
            />
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-[#dc2626] text-center" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
