import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SMS_UNAVAILABLE_MESSAGE, type OtpDeliveryResult } from '@sakya/types';

import { Msg91SmsService } from './msg91-sms.service';

/**
 * Phone OTP delivery.
 *
 * Three delivery paths behind one seam:
 *
 * - **Demo mode** (non-production only, `OTP_DEMO_MODE=true`): the code is
 *   recorded in `lastDevCode` and never handed to a provider, so a demo can be
 *   driven without an SMS inbox.
 * - **MSG91 configured** (`MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`): the
 *   code is handed to MSG91's v5 OTP API for real SMS delivery. Rejections
 *   throw so the customer is told the send failed rather than left waiting.
 * - **Not configured**: development logs the code and records it in
 *   `lastDevCode` so responses can expose it (never in production). The
 *   temporary exact-test-number path may substitute its fixed code on this
 *   branch — non-production only, exact phone match, and before the deadline.
 *
 * Production without a provider fails closed with a retryable 503.
 */
@Injectable()
export class OtpSenderService {
  private readonly logger = new Logger(OtpSenderService.name);
  private readonly isProduction: boolean;
  private readonly demoMode: boolean;

  /** Enable the temporary exact-test-number path (non-production only). */
  private readonly testOtpEnabled: boolean;
  private readonly testOtpPhone: string | null;
  private readonly testOtpCode: string | null;
  private readonly testOtpDeadline: Date | null;
  /** True only when all test-specific env values are present. */
  private readonly testOtpConfigured: boolean;

  /** Last code delivered this process, for development response bodies only. */
  lastDevCode: string | null = null;

  constructor(
    config: ConfigService,
    private readonly msg91: Msg91SmsService,
  ) {
    this.isProduction = config.getOrThrow<boolean>('app.isProduction');
    // Production guard (same as OtpService): demo mode must never swallow
    // real OTP deliveries in production, even if OTP_DEMO_MODE is misconfigured.
    this.demoMode =
      !this.isProduction && config.get<boolean>('sms.demoMode') === true;

    this.testOtpEnabled = config.get<boolean>('testOtp.enabled') === true;
    this.testOtpPhone = config.get<string | null>('testOtp.testPhone') ?? null;
    this.testOtpCode = config.get<string | null>('testOtp.code') ?? null;
    this.testOtpDeadline = config.get<string | null>('testOtp.enabledDeadline') !== null
      ? new Date(config.get<string>('testOtp.enabledDeadline')!)
      : null;
    this.testOtpConfigured =
      this.testOtpPhone !== null &&
      this.testOtpCode !== null &&
      this.testOtpDeadline !== null;
  }

  async send(phone: string, code: string): Promise<OtpDeliveryResult> {
    const now = new Date();

    // Hard production guard: the temporary exact-test-number path must never
    // run in production, even when the flag, phone, code and deadline are all
    // configured. The fixed test code is a development/staging convenience
    // only — production issues random codes or fails closed, nothing else.
    const isTestRequest = !this.isProduction
      && this.testOtpEnabled
      && this.testOtpConfigured
      && phone === this.testOtpPhone
      && this.testOtpDeadline !== null
      && this.testOtpDeadline.getTime() > now.getTime();

    // Demo mode never exits this branch: it is only reachable outside
    // production (see the constructor guard), so setting lastDevCode here
    // cannot leak the demo code into a production response body.
    if (this.demoMode) {
      this.lastDevCode = code;
      this.logger.log(
        `OTP demo mode active for •••${phone.slice(-4)} (code not sent to any provider)`,
      );
      return { phone, accepted: true };
    }

    // Real delivery whenever MSG91 is configured, in any environment.
    if (this.msg91.configured) {
      try {
        const accepted = await this.msg91.send(phone, code);
        return { phone, accepted };
      } catch (error) {
        // Rejection, transport failure or timeout: the cause goes to the server
        // log (the filter's 503 body carries only SMS_UNAVAILABLE_MESSAGE) and
        // the caller gets a retryable status rather than an internal 500.
        this.logger.error(
          `SMS delivery failed for •••${phone.slice(-4)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new ServiceUnavailableException(SMS_UNAVAILABLE_MESSAGE);
      }
    }

    if (this.isProduction) {
      // No provider configured: fail closed rather than silently pretending a
      // code went out. This is an availability gap the operator fixes by
      // configuring the provider, so it reports as 503, not as a bug (500).
      this.logger.error('SMS delivery failed: no SMS provider is configured in production');
      throw new ServiceUnavailableException(SMS_UNAVAILABLE_MESSAGE);
    }

    // Development delivery hook: the temporary exact-test phone may receive
    // the configured fixed code; every other number records the code that was
    // actually issued to it.
    if (isTestRequest && this.testOtpCode !== null) {
      this.lastDevCode = this.testOtpCode;
    } else {
      this.lastDevCode = code;
    }

    this.logger.log(
      `OTP issued for •••${phone.slice(-4)} (development delivery — not sent to any provider)`,
    );

    return { phone, accepted: true, devCode: this.lastDevCode };
  }
}
