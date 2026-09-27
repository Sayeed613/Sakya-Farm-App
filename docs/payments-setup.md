# OTP and Online Payments

## OTP Delivery

The API sends real OTP messages through MSG91 when both server environment
variables are set:

- `MSG91_AUTH_KEY`
- `MSG91_OTP_TEMPLATE_ID`

The approved MSG91 OTP template must contain `##OTP##`. `MSG91_SMS_FROM` may
override the sender ID; its default is `SAKYAFRM`. Never put MSG91 credentials
in the customer app environment.

## Razorpay UPI and Cards

Set these variables in the API deployment environment:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

Configure the Razorpay webhook URL as
`https://<api-host>/api/v1/payments/webhook/razorpay` and subscribe to
`payment.authorized`, `payment.captured`, and `payment.failed`. Use the webhook
secret configured for that endpoint as `RAZORPAY_WEBHOOK_SECRET`. The API
creates each Razorpay order from its stored order total and verifies webhook
signatures before changing payment or order status.

For the customer app, set `EXPO_PUBLIC_RAZORPAY_ENABLED=true` only in a native
build pointed at an API with Razorpay configured. The key secret and webhook
secret must never be added to Expo variables. The Razorpay SDK is native, so
Expo Go is not supported: install dependencies, run `pnpm --filter
@sakya/customer exec expo prebuild`, then create/install an Android or iOS
development/release build. The iOS configuration includes UPI app query schemes.

To keep the internal simulator instead, use
`EXPO_PUBLIC_PAYMENTS_DEMO=true` in a non-production build. Do not enable both
the simulator and live checkout for a customer release.