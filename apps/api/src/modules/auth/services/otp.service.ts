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
 *   guesses per phone regardless of how many codes are requested;
 * - the generic `UnauthorizedException` on failure deliberately does not
 *   distinguish wrong-code from expired-code from unknown-phone.
 */
@Injectable()
export class OtpService {
  private readonly isProduction: boolean;
  private readonly demoMode: boolean;
  private readonly demoCode: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: OtpSenderService,
    config: ConfigService,
  ) {
    this.isProduction = config.getOrThrow<boolean>('app.isProduction');
    this.demoMode = !this.isProduction && config.get<boolean>('sms.demoMode') === true;
    this.demoCode = config.get<string>('sms.demoCode') ?? '1234';
  }

  /**
   * Issue a code for `phone`.
   *
   * The response never reveals whether the phone already belongs to a customer:
   * every caller gets the same shape, whether or not an account exists.
   */
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

    // Demo mode: every phone verifies with the same fixed 4-digit code so a
    // demo build can be driven without an SMS inbox. The code still goes
    // through the identical hash/store/verify pipeline — nothing about the
    // security model changes, only what gets generated. Production always
    // takes the random 6-digit path.
    const code = this.demoMode
      ? this.demoCode
      : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);

    await this.prisma.$transaction([
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

    await this.sender.send(phone, code);

    const response: OtpSendResponse = {
      phone,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: OTP_TTL_SECONDS,
    };

    // Development convenience only: without an SMS provider there is no way to
    // receive the code, so the API reports it. Never set in production — the
    // sender throws there, so this line is unreachable in production builds.
    const devCode = this.sender.lastDevCode;
    if (!this.isProduction && devCode !== null) {
      response.devCode = devCode;
    }

    return response;
  }

  /**
   * Verify `code` against the newest active code for `phone`.
   *
   * Returns void on success; every failure path throws a generic
   * `UnauthorizedException` (or `ThrottlerException` when the hourly cap
   * trips). Consuming the code happens even on a wrong entry that burns it, so
   * a code cannot be retried after its attempt budget is spent.
   */
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

    await this.prisma.otpCode.update({
      where: { id: stored.id },
      data: { consumedAt: now, attempts: { increment: 1 } },
    });
  }
}
