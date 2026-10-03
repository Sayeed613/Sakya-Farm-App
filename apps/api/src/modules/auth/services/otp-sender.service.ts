import { Injectable, Logger } from '@nestjs/common';
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
 * - **Not configured**: development logs the code (and the controller may
 *   return it in the response — dev builds only); production fails closed.
 *
 * `lastDevCode` exists ONLY so the auth controller can expose the code in
 * development responses (never in production). MSG91-path sends do not
 * record it, and the field is not part of any persisted state.
 */
export interface OtpDeliveryResult {
  /** True when the message was handed to a real channel (or logged in dev). */
  accepted: boolean;
}

@Injectable()
export class OtpSenderService {
  private readonly logger = new Logger(OtpSenderService.name);
private readonly isProduction: boolean;
private readonly demoMode: boolean;  /** Last code delivered this process, for development response bodies only. */
  lastDevCode: string | null = null;

  constructor(
    config: ConfigService,
    private readonly msg91: Msg91SmsService,
  ) {
this.isProduction = config.getOrThrow<boolean>('app.isProduction');
this.demoMode = config.get<boolean>('sms.demoMode') === true;  }

  async send(phone: string, code: string): Promise<OtpDeliveryResult> {
  if (this.demoMode) {
    this.logger.log(
      `OTP demo mode active for •••${phone.slice(-4)} (code not sent to any provider)`,
    );
    return { accepted: true };
  }

  // Real delivery whenever MSG91 is configured, in any environment.
  if (this.msg91.configured) {
    const accepted = await this.msg91.send(phone, code);
    return { accepted };
  }

  if (this.isProduction) {
    // No provider configured: fail closed rather than silently pretending a
    // code went out.
    throw new Error('SMS provider is not configured');
  }

  this.lastDevCode = code;

  this.logger.log(
    `OTP issued for •••${phone.slice(-4)} (development delivery — not sent to any provider)`,
  );

  return { accepted: true };
}
}
