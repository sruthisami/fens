import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import {
  DELIVERY_DAYS,
  FREE_SHIPPING_OVER,
  SHIPPING_METHODS,
  validateAddress,
  type Address,
  type DeliveryDay,
  type ShippingMethod,
} from '../data/checkout';
import { isV2 } from '../version';
const shippingNote = (key: ShippingMethod) =>
  key === 'standard'
    ? `$${SHIPPING_METHODS.standard.price}, free on orders over $${FREE_SHIPPING_OVER}`
    : `$${SHIPPING_METHODS.express.price}`;
const readAddress = (form: HTMLFormElement): Address => {
  const value = (id: string) =>
    (form.elements.namedItem(id) as HTMLInputElement | null)?.value ?? '';
  return {
    name: value('ship-name'),
    street: value('ship-street'),
    city: value('ship-city'),
    zip: value('ship-postcode'),
  };
};
export function CheckoutShipping() {
  const navigate = useNavigate();
  const { checkout, setCheckout } = useCart();
  const [error, setError] = useState<string | null>(null);
  const methodFieldset = (
    <fieldset>
      <legend>Shipping method</legend>
      {(Object.keys(SHIPPING_METHODS) as ShippingMethod[]).map((key) => (
        <label key={key}>
          <input
            type="radio"
            name="shipping"
            value={key}
            defaultChecked={checkout.shippingMethod === key}
          />{' '}
          {SHIPPING_METHODS[key].label}: {shippingNote(key)}
        </label>
      ))}
    </fieldset>
  );
  if (isV2) {
    const submit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const address = readAddress(form);
      const problem = validateAddress(address);
      if (problem) {
        setError(problem);
        return;
      }
      const shippingMethod = (form.elements.namedItem('shipping') as RadioNodeList | null)
        ?.value as ShippingMethod;
      const deliveryDay = (form.elements.namedItem('delivery') as RadioNodeList | null)
        ?.value as DeliveryDay;
      setCheckout({ address, shippingMethod, deliveryDay });
      navigate('/checkout/billing');
    };
    return (
      <form onSubmit={submit}>
        <h1>Shipping and delivery</h1>
        {error && (
          <p role="alert" style={{ color: 'red' }}>
            {error}
          </p>
        )}
        <FormField
          id="ship-name"
          label="Full name"
          autoComplete="name"
          defaultValue={checkout.address.name}
        />
        <FormField
          id="ship-street"
          label="Street address"
          autoComplete="street-address"
          defaultValue={checkout.address.street}
        />
        <FormField
          id="ship-city"
          label="City"
          autoComplete="address-level2"
          defaultValue={checkout.address.city}
        />
        <FormField
          id="ship-postcode"
          label="ZIP code"
          autoComplete="postal-code"
          defaultValue={checkout.address.zip}
        />
        {methodFieldset}
        <fieldset>
          <legend>Delivery day</legend>
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
        </fieldset>
        <PrimaryButton type="submit">Continue</PrimaryButton>
      </form>
    );
  }
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const shippingMethod = (e.currentTarget.elements.namedItem('shipping') as RadioNodeList | null)
      ?.value as ShippingMethod;
    setCheckout({ shippingMethod });
    navigate('/checkout/address');
  };
  return (
    <form onSubmit={submit}>
      <h1>Shipping method</h1>
      {methodFieldset}
      <PrimaryButton type="submit">Continue</PrimaryButton>
    </form>
  );
}
