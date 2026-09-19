import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthSessionResponse, OtpSendResponse } from '@sakya/types';
import {
  loginSchema,
  logoutSchema,
  otpSendSchema,
  otpVerifySchema,
  refreshSchema,
  registerSchema,
  type LoginRequest,
  type LogoutRequest,
  type OtpSendRequest,
  type OtpVerifyRequest,
  type RefreshRequest,
  type RegisterRequest,
} from '@sakya/validation';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

/**
 * Per-route rate limits on top of the global throttle.
 *
 * OTP endpoints are the abuse surface. The per-phone abuse vectors are closed
 * in the service (60s resend cooldown, 5 attempts per code, 10 verifications
 * per phone per hour); these IP limits stop one caller from flooding many
 * phones. Generous enough that a shared household IP is never blocked.
 */
const OTP_SEND_THROTTLE = { default: { limit: 20, ttl: 300_000 } };
const OTP_VERIFY_THROTTLE = { default: { limit: 30, ttl: 300_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `POST /auth/otp/send` — the customer "sign in" entry point.
   *
   * One endpoint for both new and existing customers: the response is
   * identical either way, so it cannot reveal whether a phone has an account.
   */
  @Public()
  @Throttle(OTP_SEND_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('otp/send')
  sendOtp(
    @Body(new ZodValidationPipe(otpSendSchema)) body: OtpSendRequest,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<OtpSendResponse> {
    return this.authService.sendOtp(body.phone, { ipAddress, userAgent });
  }

  /**
   * `POST /auth/otp/verify` — the authentication event. Creates the customer
   * on first verification; no separate sign-up exists.
   */
  @Public()
  @Throttle(OTP_VERIFY_THROTTLE)
  // Authentication is a process, not a resource creation: answer 200.
  @HttpCode(HttpStatus.OK)
  @Post('otp/verify')
  verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyRequest,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponse> {
    return this.authService.verifyOtpAndAuthenticate(body.phone, body.otp, { ipAddress, userAgent });
  }

  /**
   * Operator-only (admin/store/delivery/support). The customer app never calls
   * these; they remain for internal systems that provision email accounts.
   */
  @Public()
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterRequest,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponse> {
    return this.authService.register(body, { ipAddress, userAgent });
  }

  /** Operator-only email + password login. Not used by the customer app. */
  @Public()
  @Post('login')
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginRequest,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponse> {
    return this.authService.login(body, { ipAddress, userAgent });
  }

  @Public()
  @Post('refresh')
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshRequest,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionResponse> {
    return this.authService.refresh(body, { ipAddress, userAgent });
  }

  @Public()
  @Post('logout')
  logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutRequest) {
    return this.authService.logout(body);
  }
}
