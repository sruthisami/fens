import { useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
export function ForgotPassword() {
  const navigate = useNavigate();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        navigate('/reset-sent');
      }}
    >
      <h1>Reset password</h1>
      <FormField id="reset-email" label="Email" type="email" autoComplete="email" />
      <PrimaryButton type="submit">Send reset link</PrimaryButton>
    </form>
  );
}
