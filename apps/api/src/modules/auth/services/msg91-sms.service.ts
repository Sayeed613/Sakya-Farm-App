import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { timeExternal } from '../../../observability/request-metrics';

/**
 * SMS OTP delivery through MSG91's v5 OTP API.
 *
 * MSG91 is used in "bring your own code" mode: this backend already generates,
 * stores, hashes and verifies the code (`OtpService`); MSG91's job is only to
 * deliver it as SMS. The API therefore receives the generated code in the
 * `otp` field instead of letting MSG91 generate one (which would need their
 * verify endpoint and would bypass the backend's OTP security model).
 *
 * Implemented with `fetch` rather than an SDK: a single JSON POST per send.
 *
 * Configuration (authkey + template_id validated as a pair at boot):
 *   MSG91_AUTH_KEY        — dashboard auth key (Settings → API)
 *   MSG91_OTP_TEMPLATE_ID — DLT-approved OTP template ID (must contain ##OTP##)
 *   MSG91_SMS_FROM        — optional sender/header id shown in the SMS; India
 *                           DLT routes usually bind the header to the template,
 *                           so this is a default, not a requirement.
 *
 * India note: delivering OTP SMS to Indian numbers requires DLT registration
 * (entity + header + template). The template text on DLT must match the
 * approved copy with ##OTP## as the code placeholder.
 */
const MSG91_OTP_URL = 'https://control.msg91.com/api/v5/otp';
/** The backend code expires after 5 minutes; keep MSG91's expiry in step. */
const MSG91_OTP_EXPIRY_MINUTES = 5;
/** The backend generates 6-digit codes. */
const MSG91_OTP_LENGTH = 6;

interface Msg91OtpResponse {
  /** MSG91 answers with `type: 'success'` or `type: 'error'`. */
  type?: string;
  message?: string;
}

@Injectable()
export class Msg91SmsService {
  private readonly logger = new Logger(Msg91SmsService.name);
  private readonly authKey: string | null;
  private readonly otpTemplateId: string | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.authKey = config.get<string | null>('sms.authKey') ?? null;
    this.otpTemplateId = config.get<string | null>('sms.otpTemplateId') ?? null;
    this.from = config.get<string>('sms.from') ?? 'SAKYAFRM';
  }

  get configured(): boolean {
    return this.authKey !== null && this.otpTemplateId !== null;
  }

  /**
   * Hand the OTP to MSG91. Returns true when the API accepted the send;
   * throws on transport failure or rejection so the auth flow can surface a
   * real error to the customer instead of leaving them waiting.
   */
  async send(phone: string, code: string): Promise<boolean> {
    if (!this.configured) {
      throw new Error('SMS provider is not configured');
    }

    // `phone` is stored normalized E.164 (`+919876…`); MSG91's v5 API expects
    // country code + number without the leading `+` (e.g. `919876543210`).
    const destination = phone.replace(/^\+/, '');

    // Timed for baseline instrumentation only: the call, its 10s cap and its
    // error behaviour are untouched — see observability/request-metrics.ts.
    const response = await timeExternal('msg91', () =>
      fetch(MSG91_OTP_URL, {
        method: 'POST',
        headers: {
          authkey: this.authKey as string,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          template_id: this.otpTemplateId,
          mobile: [destination],
          otp: code,
          otp_length: MSG91_OTP_LENGTH,
          otp_expiry: MSG91_OTP_EXPIRY_MINUTES,
          sender: this.from,
        }),
        signal: AbortSignal.timeout(10_000),
      }),
    );

    if (!response.ok) {
      throw new Error(`MSG91 OTP API responded ${response.status}`);
    }

    const payload = (await response.json()) as Msg91OtpResponse;
    if (payload.type !== undefined && payload.type !== 'success') {
      throw new Error(`MSG91 rejected the OTP send: ${payload.message ?? payload.type}`);
    }
    if (payload.type === undefined && !payload.message) {
      throw new Error('MSG91 returned no send receipt');
    }

    this.logger.debug(`MSG91 accepted OTP send: ${payload.message ?? '(no message)'}`);
    return true;
  }
}
