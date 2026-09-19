import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SMS OTP delivery through Vonage's REST API.
 *
 * Implemented with `fetch` rather than the Vonage SDK: the request is a single
 * signed POST and the response a flat JSON array, so a dependency (and its
 * transitive surface) buys nothing here.
 *
 * Vonage numbers/substitution rules: the destination is normalized E.164
 * without the leading `+` (Vonage's expected format, e.g. `919876543210`).
 *
 * Configuration (validated as a pair at boot):
 *   VONAGE_API_KEY / VONAGE_API_SECRET — dashboard credentials
 *   VONAGE_SMS_FROM                    — alphanumeric sender id (India DLT
 *                                        routes typically require a
 *                                        registered sender; set accordingly)
 */
const VONAGE_SMS_URL = 'https://rest.nexmo.com/sms/json';

interface VonageSmsResponse {
  'message-count'?: string;
  messages?: Array<{
    status: string;
    'message-id'?: string;
    'error-text'?: string;
    network?: string;
  }>;
}

@Injectable()
export class VonageSmsService {
  private readonly logger = new Logger(VonageSmsService.name);
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string | null>('sms.apiKey') ?? null;
    this.apiSecret = config.get<string | null>('sms.apiSecret') ?? null;
    this.from = config.get<string>('sms.from') ?? 'SAKYAFRM';
  }

  get configured(): boolean {
    return this.apiKey !== null && this.apiSecret !== null;
  }

  /**
   * Hand the OTP to Vonage. Returns true when every message part was
   * accepted; throws on transport failure or rejection so the auth flow can
   * surface a real error to the customer.
   */
  async send(phone: string, code: string): Promise<boolean> {
    if (!this.configured) {
      throw new Error('SMS provider is not configured');
    }

    // `phone` is stored normalized E.164 (`+919876…`); Vonage wants no `+`.
    const destination = phone.replace(/^\+/, '');

    const params = new URLSearchParams({
      api_key: this.apiKey as string,
      api_secret: this.apiSecret as string,
      to: destination,
      from: this.from,
      text: `${code} is your Sakya Farms verification code. It expires in 5 minutes. Never share this code.`,
      type: 'text',
    });

    const response = await fetch(VONAGE_SMS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Vonage SMS API responded ${response.status}`);
    }

    const payload = (await response.json()) as VonageSmsResponse;
    const messages = payload.messages ?? [];
    const failed = messages.filter((message) => message.status !== '0');
    if (failed.length > 0) {
      const detail = failed.map((message) => message['error-text'] ?? `status ${message.status}`).join('; ');
      throw new Error(`Vonage rejected the SMS: ${detail}`);
    }
    if (messages.length === 0) {
      throw new Error('Vonage returned no message receipts');
    }

    return true;
  }

  /** Kept for structured debug logging of accepted sends. */
  debugAccepted(messageId: string | undefined): void {
    this.logger.debug(`Vonage accepted message ${messageId ?? '(no id)'}`);
  }
}
