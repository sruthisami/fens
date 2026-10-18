import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import { validateAddress, type Address } from '../data/checkout';
export function CheckoutAddress() {
  const navigate = useNavigate();
  const { checkout, setCheckout } = useCart();
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const value = (id: string) =>
      (form.elements.namedItem(id) as HTMLInputElement | null)?.value ?? '';
    const address: Address = {
      name: value('addr-name'),
      street: value('addr-street'),
      city: value('addr-city'),
      zip: value('addr-postcode'),
    };
    const problem = validateAddress(address);
    if (problem) {
      setError(problem);
      return;
    }
    setCheckout({ address });
    navigate('/checkout/delivery');
  };
  return (
    <form onSubmit={submit}>
      <h1>Delivery address</h1>
      {error && (
        <p role="alert" style={{ color: 'red' }}>
          {error}
        </p>
      )}
      <FormField
        id="addr-name"
        label="Full name"
        placeholderOnly
        defaultValue={checkout.address.name}
      />
      <FormField
        id="addr-street"
        label="Street address"
        placeholderOnly
        defaultValue={checkout.address.street}
      />
      <FormField id="addr-city" label="City" placeholderOnly defaultValue={checkout.address.city} />
      <FormField
        id="addr-postcode"
        label="ZIP code"
        placeholderOnly
        defaultValue={checkout.address.zip}
      />
      <PrimaryButton type="submit">Continue</PrimaryButton>
    </form>
  );
}
