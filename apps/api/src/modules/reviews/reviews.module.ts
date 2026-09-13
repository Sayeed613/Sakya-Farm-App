import { Module } from '@nestjs/common';

/**
 * Product reviews and moderation.
 *
 * Scaffolded only. Planned endpoints under `/api/v1/reviews`:
 *
 *   GET    /products/:productId        published reviews for a product
 *   POST   /products/:productId        submit a review            (authenticated)
 *   PATCH  /:id                        edit own review
 *   DELETE /:id                        delete own review
 *   GET    /admin                      moderation queue          (reviews:read)
 *   PATCH  /admin/:id/status           approve / reject / hide   (reviews:moderate)
 *
 * Reviews default to PENDING: nothing a customer writes appears publicly until
 * it has been moderated. The unique (user_id, product_id) constraint keeps one
 * review per customer per product.
 */
@Module({})
export class ReviewsModule {}
