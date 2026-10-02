declare module 'react-native-razorpay' {
  interface RazorpayCheckoutOptions {
    key: string;
    order_id: string;
    amount: string;
    currency: string;
    name: string;
    description: string;
    method?: 'upi' | 'card' | 'netbanking';
    prefill?: {
      contact?: string;
      name?: string;
    };
    theme?: {
      color: string;
    };
  }

  interface RazorpayCheckoutResult {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOptions): Promise<RazorpayCheckoutResult>;
  };

  export default RazorpayCheckout;
}