import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { VonageSmsService } from './vonage-sms.service';

/**
 * Phone OTP delivery.
 *
 * Two delivery paths behind one seam:
 *
 * - **Vonage configured** (`VONAGE_API_KEY` + `VONAGE_API_SECRET`): the code
 *   is handed to Vonage's REST API for real SMS delivery. Rejections throw so
 *   the customer is told the send failed rather than left waiting.
 * - **Not configured**: development logs the code (and the controller may
 *   return it in the response — dev builds only); production fails closed.
 *
 * `lastDevCode` exists ONLY so the auth controller can expose the code in
 * development responses (never in production). Vonage-path sends do not
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
  /** Last code delivered this process, for development response bodies only. */
  lastDevCode: string | null = null;

  constructor(
    config: ConfigService,
    private readonly vonage: VonageSmsService,
  ) {
    this.isProduction = config.getOrThrow<boolean>('app.isProduction');
  }

  async send(phone: string, code: string): Promise<OtpDeliveryResult> {
    // Real delivery whenever Vonage is configured, in any environment — this
    // lets staging exercise the production path end-to-end.
    if (this.vonage.configured) {
      const accepted = await this.vonage.send(phone, code);
      return { accepted };
    }

    if (this.isProduction) {
      // No provider configured: fail closed rather than silently pretending a
      // code went out. Boot-time env validation makes this visible early.
      throw new Error('SMS provider is not configured');
    }

    this.lastDevCode = code;
    this.logger.log(`OTP for ${phone}: ${code} (development delivery — not sent to any provider)`);

    return { accepted: true };
  }
}
