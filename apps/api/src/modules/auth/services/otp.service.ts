import { createHash, randomInt } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { OtpSendResponse } from '@sakya/types';

import { PrismaService } from '../../../database/prisma.service';
import { OtpSenderService } from './otp-sender.service';

/** A verification code lives for five minutes. */
const OTP_TTL_SECONDS = 300;
/** After requesting a code, this long must pass before another can be sent. */
const RESEND_COOLDOWN_SECONDS = 60;
/** Wrong entries allowed per code before it is burned. */
const MAX_ATTEMPTS_PER_CODE = 5;
/** Verifications (successful or not) allowed per phone per rolling hour. */
const MAX_VERIFIES_PER_HOUR = 10;

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Phone OTP issue and verification.
 *
 * Security model, in one place:
 * - the plaintext code exists only in memory and the SMS channel; the database
 *   holds a SHA-256 hash, so a leak is not a list of working codes;
 * - issuing a new code supersedes every active code for that phone, so old
 *   messages cannot be replayed after a re-send;
 * - five wrong entries burn the code, and a rolling hourly cap bounds the
 *   guesses per phone.
 *
 * Temporary test OTP path:
 * - Only enabled when FEATURE_FLAG_TEST_OTP=true and TEST_OTP_TEST_PHONE,
 *   TEST_OTP_CODE, and TEST_OTP_ENABLED_DEADLINE are all set.
 * - The test code is served only to the explicitly configured phone.
 * - Every other phone is unaffected and cannot use the test code.
 * - All existing hash/store/verify/status rules are unchanged.
 */
@Injectable()
export class OtpService {
  private readonly isProduction: boolean;
  private readonly demoMode: boolean;
  private readonly demoCode: string;

  /** Enable the temporary exact-test-number path. */
  private readonly testOtpEnabled: boolean;
  /** True only when TEST_OTP_TEST_PHONE, TEST_OTP_CODE, and TEST_OTP_ENABLED_DEADLINE are all present. */
  private readonly testOtpConfigured: boolean;
  private readonly testOtpPhone: string | null;
  private readonly testOtpCode: string | null;
  private readonly testOtpDeadline: Date | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: OtpSenderService,
    config: ConfigService,
  ) {
    this.isProduction = config.getOrThrow<boolean>('app.isProduction');
    // Production guard (duplicated here per configuration.ts): demo mode must
    // never activate in production even if OTP_DEMO_MODE is misconfigured — the
    // same guard applies to the explicit temporary test path.
    this.demoMode = !this.isProduction && config.get<boolean>('sms.demoMode') === true;
    this.demoCode = config.get<string>('sms.demoCode') ?? '123456';

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

  /** Issue a code for `phone`. */
  async send(phone: string, metadata?: { ipAddress?: string; userAgent?: string }): Promise<OtpSendResponse> {
    const now = new Date();

    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_SECONDS * 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (recent !== null) {
      const elapsed = Math.floor((now.getTime() - recent.createdAt.getTime()) / 1000);
      throw new ThrottlerException(
        `Please wait ${RESEND_COOLDOWN_SECONDS - elapsed} seconds before requesting another code`,
      );
    }

    // Temporary exact test-number path: one explicitly configured phone, one
    // fixed 6-digit code, and only while the deadline is active. All other
    // phones still receive a normal random production code.
    //
    // Hard production guard: the fixed test code is a development/staging
    // convenience only. In production this path is unreachable even when the
    // flag, phone, code and deadline are all configured — production issues
    // random codes (delivered by MSG91) or fails closed, nothing else.
    const isTestRequest = !this.isProduction
      && this.testOtpEnabled
      && this.testOtpConfigured
      && phone === this.testOtpPhone
      && this.testOtpDeadline !== null
      && this.testOtpDeadline.getTime() > now.getTime();

    // Demo mode: every phone verifies with the same fixed 6-digit code so a
    // demo build can be driven without an SMS inbox. The code still goes
    // through the identical hash/store/verify pipeline — nothing about the
    // security model changes, only what gets generated. Production always
    // takes the random 6-digit path.
    const code = isTestRequest
      ? this.testOtpCode!
      : this.demoMode
        ? this.demoCode
        : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);

    const [, created] = await this.prisma.$transaction([
      // Supersede any still-active codes for this phone: one live code at a time.
      this.prisma.otpCode.updateMany({
        where: { phone, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      }),
      this.prisma.otpCode.create({
        data: {
          phone,
          tokenHash: hashOtp(code),
          expiresAt,
          attempts: 0,
          ipAddress: metadata?.ipAddress ?? null,
          userAgent: metadata?.userAgent ?? null,
        },
      }),
    ]);

    try {
      await this.sender.send(phone, code);
    } catch (error) {
      // The code was committed but never left the building. Remove it, or the
      // resend cooldown it just started would refuse the caller's next attempt
      // for a full minute on top of the failure they already saw — the retry
      // would answer 429 instead of reaching the provider.
      if (created?.id !== undefined) {
        await this.prisma.otpCode.deleteMany({ where: { id: created.id } });
      }
      throw error;
    }

    const response: OtpSendResponse = {
      phone,
      accepted: true,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: OTP_TTL_SECONDS,
    };

    // Development convenience only: without an SMS provider there is no way to
    // receive the code, so the API reports it. Never set in production — the
    // sender throws there, so this line is unreachable in production builds.
    // The delivery hook records the code only for the channel that logged it;
    // the exact-test-number path is honoured inside OtpSenderService.
    const devCode = this.sender.lastDevCode;
    if (!this.isProduction && devCode !== null) {
      response.devCode = devCode;
    }

    return response;
  }

  /** Verify `code` against the newest active code for `phone`. */
  async verify(phone: string, code: string, _metadata?: { ipAddress?: string; userAgent?: string }): Promise<void> {
    const now = new Date();

    const hourly = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
    });
    if (hourly >= MAX_VERIFIES_PER_HOUR) {
      throw new ThrottlerException('Too many verification attempts. Try again later.');
    }

    const stored = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    // No active code: same error as a wrong code, so responses cannot be used
    // to distinguish "never sent", "expired" and "already used".
    if (stored === null) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (hashOtp(code) !== stored.tokenHash) {
      const attempts = stored.attempts + 1;
      const burned = attempts >= MAX_ATTEMPTS_PER_CODE;

      await this.prisma.otpCode.update({
        where: { id: stored.id },
        data: {
          attempts,
          // Burn the code once the attempt budget is spent.
          ...(burned ? { consumedAt: now } : {}),
        },
      });

      throw new UnauthorizedException('Invalid or expired code');
    }

    // One-time consumption for every code: temporary test codes use the exact
    // same single-use and burn rules as production codes.
    await this.prisma.otpCode.update({
      where: { id: stored.id },
      data: { consumedAt: now, attempts: { increment: 1 } },
    });
  }
}
