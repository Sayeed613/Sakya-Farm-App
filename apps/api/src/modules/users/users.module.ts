import { Module } from '@nestjs/common';

/**
 * Users and profiles.
 *
 * Scaffolded only: the schema (`users`, `addresses`, `user_roles`) exists and the
 * module is wired so that adding controllers later is additive. Planned endpoints
 * under `/api/v1/users`:
 *
 *   GET    /me                     current profile            (authenticated)
 *   PATCH  /me                     update own profile
 *   GET    /me/addresses           list saved addresses
 *   POST   /me/addresses           add an address
 *   PATCH  /me/addresses/:id       edit an address
 *   DELETE /me/addresses/:id       remove an address
 *   GET    /                       list users                 (users:read)
 *   GET    /:id                    fetch a user               (users:read)
 *   PATCH  /:id/status             suspend or reactivate      (users:suspend)
 *
 * Passwords are handled exclusively by the auth module via
 * PasswordHasherService; this module never reads or writes a password hash.
 */
@Module({})
export class UsersModule {}
