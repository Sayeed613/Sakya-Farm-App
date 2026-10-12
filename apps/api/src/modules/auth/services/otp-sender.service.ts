import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Msg91SmsService } from './msg91-sms.service';

/**
 * Phone OTP delivery.
 *
 * Two delivery paths behind one seam:
 *
 * - **MSG91 configured** (`MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`): the
 *   code is handed to MSG91's v5 OTP API for real SMS delivery. Rejections
 *   throw so the customer is told the send failed rather than left waiting.
 * - **Not configured**: development logs the code and records it in
 *   `lastDevCode` so the auth controller can expose the code in development
 *   responses (never in production). MSG91-path sends do not record it, and
 *   the field is not part of any persisted state.
 */
export interface OtpDeliveryResult {
  /** True when the message was handed to a real channel (or logged in dev). */
  accepted: boolean;
}

/**
 * What an unauthenticated caller is told when a code cannot be delivered.
 *
 * The exception filter answers a plain `Error` with 500 / INTERNAL_ERROR, which
 * reads as "the server is broken" for what is really an SMS-channel outage —
 * and it buries the cause: the filter returns `exception.message` verbatim, so
 * any detail put here would be handed to the public. The specifics (which
 * provider, why it refused) are logged instead, and 503 is the status the
 * client can legitimately retry.
 */
const SMS_UNAVAILABLE_MESSAGE =
  'SMS delivery is unavailable right now. Please try again in a moment.';

@Injectable()
export class OtpSenderService {
  private readonly logger = new Logger(OtpSenderService.name);  private readonly isProduction: boolean;
  private readonly demoMode: boolean;
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
  }

  async send(phone: string, code: string): Promise<OtpDeliveryResult> {
    // Demo mode never exits this branch: it is only reachable outside
    // production (see the constructor guard), so setting lastDevCode here
    // cannot leak the demo code into a production response body.
    if (this.demoMode) {
      this.lastDevCode = code;
      this.logger.log(
        `OTP demo mode active for •••${phone.slice(-4)} (code not sent to any provider)`,
      );
      return { accepted: true };
    }

    // Real delivery whenever MSG91 is configured, in any environment.
    if (this.msg91.configured) {
      try {
        const accepted = await this.msg91.send(phone, code);
        return { accepted };
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

    this.lastDevCode = code;

    this.logger.log(
      `OTP issued for •••${phone.slice(-4)} (development delivery — not sent to any provider)`,
    );

    return { accepted: true };
  }
}
