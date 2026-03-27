/**
 * Twilio SMS Webhook Route — Task 5.1
 *
 * Express route (NOT tRPC) mounted at /api/sms/incoming.
 * Twilio delivers incoming SMS as application/x-www-form-urlencoded POST.
 *
 * Security: sender phone checked against ADMIN_PHONE_NUMBERS inside
 * executeCommand — no Twilio signature verification required per spec.
 *
 * Response: TwiML MessagingResponse (text/xml). Always 200 so Twilio
 * does not retry the delivery.
 *
 * PRD §6.5 — SMS command interface
 */

import { Router } from "express";
import type { Request, Response } from "express";
import twilio from "twilio";
import { executeCommand } from "../services/smsCommands.js";

const smsRouter = Router();

/**
 * POST /api/sms/incoming
 *
 * 1. Extract From (sender E.164) and Body (message text) from Twilio params.
 * 2. Delegate to executeCommand — handles auth check + command dispatch.
 * 3. Reply with TwiML containing the result or error text.
 */
smsRouter.post(
  "/incoming",
  async (req: Request, res: Response): Promise<void> => {
    const from = req.body.From as string | undefined;
    const body = req.body.Body as string | undefined;

    // Guard against malformed Twilio payloads
    if (!from || !body) {
      sendTwiml(res, "Error: Missing required Twilio parameters.");
      return;
    }

    try {
      const reply = await executeCommand(from, body);
      sendTwiml(res, reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[sms] Unhandled error in executeCommand:", err);
      sendTwiml(res, `Error: ${msg}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendTwiml(res: Response, message: string): void {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

export default smsRouter;
