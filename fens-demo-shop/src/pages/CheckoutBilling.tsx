import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import { cardBrand, DEMO_CARD, validateExpiry } from '../data/checkout';
import { isV2 } from '../version';
export function CheckoutBilling() {
  const navigate = useNavigate();
  const { items, pricing, checkout, setPayment, placeOrder } = useCart();
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
    const number = value('card-number').replace(/\s+/g, '');
    const expiry = value('card-expiry').trim();
    const cvc = value('card-cvc').trim();
    if (!/^\d{13,19}$/.test(number))
      return setError('Please enter a valid card number (13-19 digits)');
    const expiryProblem = validateExpiry(expiry);
    if (expiryProblem) return setError(expiryProblem);
    if (!/^\d{3,4}$/.test(cvc)) return setError('Please enter a valid security code (3-4 digits)');
    const paymentInfo = { cardLast4: number.slice(-4), cardBrand: cardBrand(number) };
    setPayment(paymentInfo);
    if (isV2) {
      void placeOrder(paymentInfo, () => navigate('/checkout/confirmation'));
    } else {
      navigate('/checkout/review');
    }
  };
  const money = (n: number) => `$${n.toFixed(2)}`;
  return (
    <form onSubmit={submit}>
      <h1>Payment</h1>
      {error && (
        <p role="alert" style={{ color: 'red' }}>
          {error}
        </p>
      )}
      <FormField
        id="card-number"
        label="Card number"
        autoComplete="cc-number"
        defaultValue={DEMO_CARD.number}
      />
      <FormField
        id="card-expiry"
        label="Expiry (MM/YY)"
        autoComplete="cc-exp"
        defaultValue={DEMO_CARD.expiry}
      />
      <FormField
        id="card-cvc"
        label="Security code"
        autoComplete="cc-csc"
        defaultValue={DEMO_CARD.cvc}
      />
      {isV2 && (
        <section className="summary" aria-label="Order summary">
          <p>
            Deliver to {checkout.address.name}, {checkout.address.street}, {checkout.address.city}{' '}
            {checkout.address.zip}
          </p>
          <p>
            {items.reduce((n, i) => n + i.quantity, 0)} item(s): subtotal {money(pricing.subtotal)},
            shipping {pricing.shipping === 0 ? 'free' : money(pricing.shipping)}, tax{' '}
            {money(pricing.tax)}, total <strong>{money(pricing.total)}</strong>
          </p>
        </section>
      )}
      <PrimaryButton type="submit">{isV2 ? 'Place order' : 'Continue'}</PrimaryButton>
    </form>
  );
}
