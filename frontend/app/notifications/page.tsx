"use client";

import { useState, useEffect, useCallback } from "react";
import { getToken, getStoredUser } from "@/lib/auth";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// iOS detection helpers
// ---------------------------------------------------------------------------

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function isIOSChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIOS() && /CriOS/.test(navigator.userAgent);
}

/**
 * /notifications — Notification preferences page.
 *
 * Lets users:
 *   1. Enable/disable browser push notifications (with iOS-specific guidance)
 *   2. Opt in to SMS notifications (consent for toll-free messaging)
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [pushStatus, setPushStatus] = useState<
    "loading" | "unsupported" | "denied" | "enabled" | "disabled" | "ios-need-safari" | "ios-need-homescreen"
  >("loading");
  const [smsOptedIn, setSmsOptedIn] = useState(false);
  const [smsLoading, setSmsLoading] = useState(false);
  const user = getStoredUser();

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }

    // iOS Chrome → must use Safari
    if (isIOSChrome()) {
      setPushStatus("ios-need-safari");
      setSmsOptedIn(localStorage.getItem("sms-opted-in") === "true");
      return;
    }

    // iOS Safari not added to home screen
    if (isIOS() && !isStandalone()) {
      setPushStatus("ios-need-homescreen");
      setSmsOptedIn(localStorage.getItem("sms-opted-in") === "true");
      return;
    }

    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPushStatus("unsupported");
      setSmsOptedIn(localStorage.getItem("sms-opted-in") === "true");
      return;
    }

    if (Notification.permission === "denied") {
      setPushStatus("denied");
      setSmsOptedIn(localStorage.getItem("sms-opted-in") === "true");
      return;
    }

    // Check if subscribed
    void navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setPushStatus(sub ? "enabled" : "disabled");
    });

    // Check SMS opt-in from localStorage
    setSmsOptedIn(localStorage.getItem("sms-opted-in") === "true");
  }, [router]);

  const handleEnablePush = useCallback(async () => {
    try {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setPushStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Get VAPID key
      const res = await fetch("/api/trpc/push.vapidPublicKey?batch=1&input=%7B%220%22%3A%7B%7D%7D");
      const data = await res.json();
      const vapidKey = data?.[0]?.result?.data?.key;
      if (!vapidKey) return;

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      const token = getToken();
      if (!token) return;

      const subJson = subscription.toJSON();
      await fetch("/api/trpc/push.subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          "0": {
            json: {
              endpoint: subscription.endpoint,
              p256dh: subJson.keys?.p256dh ?? "",
              auth: subJson.keys?.auth ?? "",
            },
          },
        }),
      });

      setPushStatus("enabled");
    } catch (err) {
      console.error("[notifications] Push enable failed:", err);
    }
  }, []);

  const handleDisablePush = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const token = getToken();
        if (token) {
          await fetch("/api/trpc/push.unsubscribe", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              "0": { json: { endpoint: subscription.endpoint } },
            }),
          });
        }
        await subscription.unsubscribe();
      }

      setPushStatus("disabled");
    } catch (err) {
      console.error("[notifications] Push disable failed:", err);
    }
  }, []);

  const handleSmsOptIn = useCallback(async () => {
    setSmsLoading(true);
    try {
      // Just record the consent locally and on the server
      const token = getToken();
      if (token) {
        // For now, opting in is just a local flag — when toll-free is verified,
        // SMS will automatically go out to all registered users.
        localStorage.setItem("sms-opted-in", "true");
        setSmsOptedIn(true);
      }
    } finally {
      setSmsLoading(false);
    }
  }, []);

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-24">
      <h1 className="font-serif text-2xl font-semibold text-charcoal mb-6">
        Notifications
      </h1>

      {/* Push Notifications */}
      <section className="bg-white rounded-xl border border-gold/20 p-5 mb-4">
        <h2 className="font-semibold text-lg mb-1">Push Notifications</h2>
        <p className="text-sm text-charcoal/60 mb-4">
          Get instant alerts when new markets open, someone places a bet on a
          market you&apos;re watching, and periodic market updates.
        </p>

        {pushStatus === "loading" && (
          <div className="text-sm text-charcoal/40">Loading...</div>
        )}

        {pushStatus === "ios-need-safari" && (
          <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
            <p className="font-medium">Chrome on iPhone doesn&apos;t support push</p>
            <p className="mt-1 text-amber-600">
              Open this page in <strong>Safari</strong>, then tap{" "}
              <strong>Share</strong> (the box with arrow) &gt;{" "}
              <strong>Add to Home Screen</strong>. Open from there to enable notifications.
            </p>
          </div>
        )}

        {pushStatus === "ios-need-homescreen" && (
          <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
            <p className="font-medium">Add to Home Screen to enable push</p>
            <p className="mt-1 text-amber-600">
              Tap the <strong>Share</strong> button (box with arrow at the bottom),
              then <strong>Add to Home Screen</strong>. Open Shaadi Book from your
              home screen to enable push notifications.
            </p>
          </div>
        )}

        {pushStatus === "unsupported" && (
          <div className="text-sm text-red-600">
            Push notifications are not supported on this browser. Try Chrome on
            desktop/Android, or Safari on iPhone (add to Home Screen first).
          </div>
        )}

        {pushStatus === "denied" && (
          <div className="text-sm text-red-600">
            Push notifications are blocked. Please enable them in your browser
            settings for this site, then refresh.
          </div>
        )}

        {pushStatus === "enabled" && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-700 font-medium">
              Enabled
            </span>
            <button
              onClick={handleDisablePush}
              className="text-sm text-charcoal/60 underline hover:text-charcoal"
            >
              Disable
            </button>
          </div>
        )}

        {pushStatus === "disabled" && (
          <button
            onClick={handleEnablePush}
            className="w-full bg-gold text-white font-semibold py-2.5 rounded-lg hover:bg-gold/90 transition-colors"
          >
            Enable Push Notifications
          </button>
        )}
      </section>

      {/* SMS Notifications */}
      <section className="bg-white rounded-xl border border-gold/20 p-5 mb-4">
        <h2 className="font-semibold text-lg mb-1">SMS Notifications</h2>
        <p className="text-sm text-charcoal/60 mb-4">
          Receive text message updates about new markets, bet activity, and
          market results to {user?.phone || "your registered phone number"}.
        </p>

        {smsOptedIn ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-700 font-medium">
              Opted in
            </span>
            <button
              onClick={() => {
                localStorage.removeItem("sms-opted-in");
                setSmsOptedIn(false);
              }}
              className="text-sm text-charcoal/60 underline hover:text-charcoal"
            >
              Opt out
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-charcoal/50 mb-3">
              By opting in you consent to receive automated text messages from
              Shaadi Book (Elysium Services LLC) at your registered number.
              Message frequency varies. Msg & data rates may apply. Reply STOP
              to unsubscribe.
            </p>
            <button
              onClick={handleSmsOptIn}
              disabled={smsLoading}
              className="w-full bg-gold text-white font-semibold py-2.5 rounded-lg hover:bg-gold/90 transition-colors disabled:opacity-50"
            >
              {smsLoading ? "Opting in..." : "Opt In to SMS"}
            </button>
          </>
        )}
      </section>

      <p className="text-xs text-charcoal/40 text-center mt-6">
        Shaadi Book by Elysium Services LLC
        <br />
        14 Barbieri Court, Princeton NJ 08540
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
