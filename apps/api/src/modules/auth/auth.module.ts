import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { PrismaModule } from '../../database/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpSenderService } from './services/otp-sender.service';
import { OtpService } from './services/otp.service';
import { PasswordHasherService } from './services/password-hasher.service';
import { VonageSmsService } from './services/vonage-sms.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Authentication foundation.
 *
 * Two authentication paths share this module:
 *
 * - **Customers**: phone + OTP (`POST /auth/otp/send`, `POST /auth/otp/verify`).
 *   Verification is the registration event; no password ever exists for a
 *   phone-first customer.
 * - **Operators** (admin, store, delivery, support): email + password, kept for
 *   the internal apps. Provisioned through seeding, not open registration.
 *
 * Both paths issue the same refresh-token model: hashed tokens, family-based
 * rotation, replay detection, and logout revocation.
 *
 * Note `session: false`: tokens are carried in the Authorization header, not in
 * a cookie, because the primary clients are mobile apps.
 */

/**
 * TTLs come from configuration as validated strings (`15m`, `30d`), while
 * `@nestjs/jwt` types `expiresIn` with `ms`'s template-literal type. This is the
 * single place that crossing is acknowledged.
 */
function asExpiresIn(value: string): JwtSignOptions['expiresIn'] {
  return value as unknown as JwtSignOptions['expiresIn'];
}

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('auth.accessSecret'),
        signOptions: {
          expiresIn: asExpiresIn(configService.getOrThrow<string>('auth.accessTtl')),
          issuer: configService.getOrThrow<string>('auth.issuer'),
          audience: configService.getOrThrow<string>('auth.audience'),
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, PasswordHasherService, VonageSmsService, OtpSenderService, OtpService, AuthService],
  exports: [JwtModule, PasswordHasherService, OtpService, AuthService],
})
export class AuthModule {}
