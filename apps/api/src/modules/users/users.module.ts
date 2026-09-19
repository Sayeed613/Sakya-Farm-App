import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { UsersController } from './users.controller';

/**
 * Users, profiles and the saved-address book.
 *
 * Implemented:
 *
 *   GET    /me                     current profile            (authenticated)
 *   PATCH  /me                     update own profile (name, optional email)
 *   GET    /me/addresses           list saved addresses       (authenticated)
 *   POST   /me/addresses           add an address             (authenticated)
 *   PATCH  /me/addresses/:id       edit an address            (authenticated)
 *   DELETE /me/addresses/:id       remove an address          (authenticated)
 *
 * Planned endpoints under `/api/v1/users`:
 *
 *   GET    /                       list users                 (users:read)
 *   GET    /:id                    fetch a user               (users:read)
 *   PATCH  /:id/status             suspend or reactivate      (users:suspend)
 *
 * `PATCH /me` is the minimal profile-completion step for phone-first
 * customers; the account itself is created by OTP verification, not here.
 * The address book powers the checkout address selector for signed-in
 * customers; guests keep the free-form checkout sheet. Passwords are handled
 * exclusively by the auth module via PasswordHasherService; this module never
 * reads or writes a password hash.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController, AddressesController],
  providers: [AddressesService],
})
export class UsersModule {}
