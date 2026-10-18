import { Link, useNavigate } from 'react-router-dom';
import { PrimaryButton } from '../components/PrimaryButton';
export function CheckoutAccount() {
  const navigate = useNavigate();
  return (
    <section>
      <h1>Checkout</h1>
      <p>How would you like to continue?</p>
      <PrimaryButton onClick={() => navigate('/checkout/shipping')}>
        Continue as guest
      </PrimaryButton>
      <p>
        <Link to="/login">Sign in</Link> to use your saved details.
      </p>
    </section>
  );
}
