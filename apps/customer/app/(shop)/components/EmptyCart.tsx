import { EmptyState } from '../../../src/components/EmptyState';

interface EmptyCartProps {
  onBrowse: () => void;
}

export default function EmptyCart({ onBrowse }: EmptyCartProps) {
  return (
    <EmptyState
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      image={require('../../../src/assets/empty-cart.png')}
      title="Your cart is empty"
      message="Add something fresh and come back to check out."
      ctaLabel="Browse products"
      onCta={onBrowse}
    />
  );
}