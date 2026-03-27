"use client";

/**
 * Login / Register — app/login/page.tsx
 *
 * Flow:
 *   1. Guest enters name + phone (country US/IN) → "Send OTP"
 *      → calls auth.sendOTP (tRPC mutation)
 *   2. Returned to OTP screen → enters 6-digit code
 *      → auto-submits on last digit (or manual "Verify")
 *      → calls auth.verifyOTP → stores JWT + user profile → redirects to /
 */

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput, isValidPhone } from "@/components/PhoneInput";
import { OTPInput } from "@/components/OTPInput";
import { api } from "@/lib/api";
import { setToken, storeUser, getToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "phone" | "otp";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const router = useRouter();

  // If already authenticated, skip to the feed
  useEffect(() => {
    if (getToken()) {
      router.replace("/");
    }
  }, [router]);

  const [step, setStep] = useState<Step>("phone");

  // Phone step
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<"US" | "IN">("US");
  const [phoneError, setPhoneError] = useState("");
  const [nameError, setNameError] = useState("");

  // OTP step
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");

  // Shared
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  // ---------------------------------------------------------------------------
  // Step 1: send OTP
  // ---------------------------------------------------------------------------

  const handleSendOTP = useCallback(async () => {
    setGlobalError("");
    setNameError("");
    setPhoneError("");

    let hasError = false;

    if (!name.trim()) {
      setNameError("Please enter your name.");
      hasError = true;
    }

    if (!isValidPhone(phone, country)) {
      setPhoneError(
        country === "US"
          ? "Enter a valid 10-digit US number."
          : "Enter a valid 10-digit Indian mobile number (starts with 6–9)."
      );
      hasError = true;
    }

    if (hasError) return;

    setIsLoading(true);
    try {
      await api.auth.sendOTP({ phone, country, name: name.trim() });
      setOtp("");
      setOtpError("");
      setStep("otp");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to send OTP. Try again.";
      setGlobalError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [name, phone, country]);

  // ---------------------------------------------------------------------------
  // Step 2: verify OTP
  // ---------------------------------------------------------------------------

  const handleVerifyOTP = useCallback(
    async (code: string) => {
      if (code.length !== 6) return;
      setOtpError("");
      setGlobalError("");
      setIsLoading(true);

      try {
        const result = await api.auth.verifyOTP({ phone, country, code });
        setToken(result.token);
        storeUser({
          id: result.user.id,
          name: result.user.name,
          phone: result.user.phone,
          country: result.user.country,
          role: result.user.role,
        });
        router.replace("/");
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Invalid or expired code. Try again.";
        setOtpError(msg);
        setOtp("");
      } finally {
        setIsLoading(false);
      }
    },
    [phone, country, router]
  );

  const handleOTPComplete = useCallback(
    (code: string) => {
      void handleVerifyOTP(code);
    },
    [handleVerifyOTP]
  );

  // ---------------------------------------------------------------------------
  // Handle phone/country change
  // ---------------------------------------------------------------------------

  const handlePhoneChange = useCallback(
    (rawDigits: string, newCountry: "US" | "IN") => {
      setPhone(rawDigits);
      setCountry(newCountry);
      setPhoneError("");
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-amber-50 to-wedding-gold-pale flex flex-col">
      {/* Decorative top bar */}
      <div className="h-1 bg-gradient-to-r from-brand-400 via-wedding-gold to-brand-600" />

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10">
        {/* Logo / branding */}
        <div className="text-center mb-10 animate-fade-in">
          <div className="text-5xl mb-3 select-none">💍</div>
          <h1 className="text-3xl font-bold text-brand-700 tracking-tight">
            Shaadi Book
          </h1>
          <p className="mt-1.5 text-sm text-brand-500 font-medium">
            Parsh &amp; Spoorthi · Udaipur
          </p>
          <p className="mt-3 text-xs text-gray-400">
            Live prediction markets for the big day
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl shadow-brand-100/40 border border-brand-100 overflow-hidden animate-slide-up">
          {/* Step header */}
          <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-5">
            <h2 className="text-lg font-bold text-white">
              {step === "phone" ? "Welcome!" : "Enter your code"}
            </h2>
            <p className="text-sm text-brand-200 mt-0.5">
              {step === "phone"
                ? "Sign in or create your account to join the fun."
                : `We sent a 6-digit code to ${country === "US" ? "+1" : "+91"} ${phone}.`}
            </p>
          </div>

          <div className="px-6 py-7 flex flex-col gap-5">
            {/* ---- Step 1: Phone + name ---- */}
            {step === "phone" && (
              <>
                {/* Name input */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="name-input"
                    className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    Your name
                  </label>
                  <input
                    id="name-input"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSendOTP();
                    }}
                    placeholder="e.g. Priya Sharma"
                    disabled={isLoading}
                    aria-invalid={Boolean(nameError)}
                    className={`w-full rounded-2xl border px-4 py-3.5 text-sm bg-white
                      focus:outline-none transition-colors placeholder:text-gray-300
                      ${
                        nameError
                          ? "border-red-400 ring-1 ring-red-400"
                          : "border-gray-200 focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
                      }
                      ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                  {nameError && (
                    <p className="text-xs text-red-500 px-1" role="alert">
                      {nameError}
                    </p>
                  )}
                </div>

                {/* Phone input */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Mobile number
                  </label>
                  <PhoneInput
                    value={phone}
                    country={country}
                    onChange={handlePhoneChange}
                    disabled={isLoading}
                    error={phoneError}
                  />
                  {country === "IN" && (
                    <p className="text-[11px] text-gray-400 px-1">
                      ₹93 ≈ $1 · all bets are in USD
                    </p>
                  )}
                </div>

                {/* Global error */}
                {globalError && (
                  <p className="text-xs text-red-500 text-center" role="alert">
                    {globalError}
                  </p>
                )}

                {/* CTA */}
                <button
                  onClick={() => void handleSendOTP()}
                  disabled={isLoading}
                  className="w-full py-4 rounded-2xl bg-brand-600 hover:bg-brand-700 active:scale-95
                             text-white font-bold text-sm tracking-wide transition-all
                             disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                             shadow-lg shadow-brand-200"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      Sending…
                    </span>
                  ) : (
                    "Send OTP →"
                  )}
                </button>
              </>
            )}

            {/* ---- Step 2: OTP ---- */}
            {step === "otp" && (
              <>
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs text-gray-400 text-center">
                    Didn&apos;t receive it? Check spam, or{" "}
                    <button
                      type="button"
                      onClick={() => setStep("phone")}
                      className="text-brand-600 font-semibold underline underline-offset-2"
                      disabled={isLoading}
                    >
                      go back
                    </button>
                    .
                  </p>
                </div>

                <OTPInput
                  value={otp}
                  onChange={setOtp}
                  onComplete={handleOTPComplete}
                  disabled={isLoading}
                  error={otpError}
                />

                {/* Global error */}
                {globalError && (
                  <p className="text-xs text-red-500 text-center" role="alert">
                    {globalError}
                  </p>
                )}

                {/* Manual submit */}
                <button
                  onClick={() => void handleVerifyOTP(otp)}
                  disabled={isLoading || otp.length < 6}
                  className="w-full py-4 rounded-2xl bg-brand-600 hover:bg-brand-700 active:scale-95
                             text-white font-bold text-sm tracking-wide transition-all
                             disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
                             shadow-lg shadow-brand-200"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      Verifying…
                    </span>
                  ) : (
                    "Verify & Join →"
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-[11px] text-gray-400 text-center max-w-xs">
          By continuing you agree to the{" "}
          <span className="text-gray-500">fun vibes</span> of Parsh &amp;
          Spoorthi&apos;s wedding. All payouts in USD via Venmo/Zelle
          post-event.
        </p>
      </div>

      {/* Decorative bottom bar */}
      <div className="h-1 bg-gradient-to-r from-wedding-gold via-brand-400 to-wedding-gold" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Micro helpers
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      className="w-4 h-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
