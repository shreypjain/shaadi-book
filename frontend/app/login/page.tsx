"use client";

/**
 * Login / Register — app/login/page.tsx
 *
 * Flow:
 *   1. Guest enters name + phone (country US/IN) → "Continue"
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

type Step = "phone" | "otp";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  const [step, setStep] = useState<Step>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<"US" | "IN">("US");
  const [phoneError, setPhoneError] = useState("");
  const [nameError, setNameError] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
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
      setGlobalError(
        err instanceof Error ? err.message : "Failed to send OTP. Try again."
      );
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
        setOtpError(
          err instanceof Error
            ? err.message
            : "Invalid or expired code. Try again."
        );
        setOtp("");
      } finally {
        setIsLoading(false);
      }
    },
    [phone, country, router]
  );

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
    <div className="min-h-screen bg-ivory flex flex-col">
      {/* Warm gold accent line */}
      <div className="h-0.5 bg-gold" />

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-12">
        {/* Branding */}
        <div className="text-center mb-10 animate-fade-in">
          <h1 className="font-serif text-4xl font-semibold text-charcoal tracking-[0.05em] uppercase">
            Shaadi Book
          </h1>
          {/* Gold accent underline */}
          <div className="mt-3 h-px w-14 mx-auto bg-gold" />
          <p className="font-sans mt-3 text-sm italic text-warmGray font-light">
            Parsh &amp; Spoorthi &bull; Leela Palace, Udaipur
          </p>
          <p className="font-sans mt-1.5 text-xs text-warmGray/70">
            Live prediction markets for the big day
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm bg-ivory-card rounded-xl shadow-card border border-[rgba(184,134,11,0.15)] overflow-hidden animate-slide-up">
          {/* Card header */}
          <div className="px-6 py-4 border-b border-[rgba(184,134,11,0.10)] bg-ivory">
            <h2 className="font-sans text-sm font-semibold text-charcoal">
              {step === "phone" ? "Sign in to your account" : "Enter verification code"}
            </h2>
            <p className="font-sans text-xs text-warmGray mt-0.5">
              {step === "phone"
                ? "New guests will be registered automatically."
                : `We sent a 6-digit code to ${
                    country === "US" ? "+1" : "+91"
                  } ${phone}.`}
            </p>
          </div>

          <div className="px-6 py-6 flex flex-col gap-5">
            {/* ---- Step 1: Phone + name ---- */}
            {step === "phone" && (
              <>
                {/* Name input */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="name-input"
                    className="text-xs font-medium text-warmGray uppercase tracking-wider"
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
                    className={`w-full rounded-lg border px-4 py-3 text-sm bg-white text-charcoal
                      focus:outline-none transition-colors placeholder:text-warmGray/40
                      ${
                        nameError
                          ? "border-[#dc2626] ring-1 ring-[#dc2626]"
                          : "border-[rgba(184,134,11,0.20)] focus:border-gold focus:ring-1 focus:ring-gold/30"
                      }
                      ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                  {nameError && (
                    <p className="text-xs text-[#dc2626] px-1" role="alert">
                      {nameError}
                    </p>
                  )}
                </div>

                {/* Phone input */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-warmGray uppercase tracking-wider">
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
                    <p className="text-[11px] text-warmGray/70 px-1">
                      All bets are placed in USD
                    </p>
                  )}
                </div>

                {globalError && (
                  <p className="text-xs text-[#dc2626] text-center" role="alert">
                    {globalError}
                  </p>
                )}

                <button
                  onClick={() => void handleSendOTP()}
                  disabled={isLoading}
                  className="w-full py-3.5 rounded-lg bg-gold hover:bg-gold-600 active:scale-95
                             text-white font-medium text-sm tracking-wide transition-all
                             disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      Sending…
                    </span>
                  ) : (
                    "Continue"
                  )}
                </button>
              </>
            )}

            {/* ---- Step 2: OTP ---- */}
            {step === "otp" && (
              <>
                <div className="text-center">
                  <p className="text-xs text-warmGray">
                    Didn&apos;t receive it? Check spam, or{" "}
                    <button
                      type="button"
                      onClick={() => setStep("phone")}
                      className="text-gold font-medium underline underline-offset-2"
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
                  onComplete={(code) => void handleVerifyOTP(code)}
                  disabled={isLoading}
                  error={otpError}
                />

                {globalError && (
                  <p className="text-xs text-[#dc2626] text-center" role="alert">
                    {globalError}
                  </p>
                )}

                <button
                  onClick={() => void handleVerifyOTP(otp)}
                  disabled={isLoading || otp.length < 6}
                  className="w-full py-3.5 rounded-lg bg-gold hover:bg-gold-600 active:scale-95
                             text-white font-medium text-sm tracking-wide transition-all
                             disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      Verifying…
                    </span>
                  ) : (
                    "Verify & Join"
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-[11px] text-warmGray/70 text-center max-w-xs">
          By continuing you agree to the rules of Parsh &amp; Spoorthi&apos;s
          wedding. All payouts in USD post-event.
        </p>
        <a
          href="/rules"
          className="mt-2 text-[11px] text-gold underline underline-offset-2 text-center"
        >
          Read the rules →
        </a>
      </div>

      {/* Bottom accent line */}
      <div className="h-0.5 bg-gold" />
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
