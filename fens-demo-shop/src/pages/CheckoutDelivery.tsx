import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import { DELIVERY_DAYS, type DeliveryDay } from '../data/checkout';
export function CheckoutDelivery() {
  const navigate = useNavigate();
  const { checkout, setCheckout } = useCart();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const deliveryDay = (e.currentTarget.elements.namedItem('delivery') as RadioNodeList | null)
      ?.value as DeliveryDay;
    setCheckout({ deliveryDay });
    navigate('/checkout/billing');
  };
  return (
    <form onSubmit={submit}>
      <h1>Delivery day</h1>
      {(Object.keys(DELIVERY_DAYS) as DeliveryDay[]).map((key) => (
        <label key={key}>
          <input
            type="radio"
            name="delivery"
            value={key}
            defaultChecked={checkout.deliveryDay === key}
          />{' '}
          {DELIVERY_DAYS[key]}
        </label>
      ))}
      <PrimaryButton type="submit">Continue</PrimaryButton>
    </form>
  );
}
