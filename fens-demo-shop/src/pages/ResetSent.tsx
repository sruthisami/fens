import { Link } from 'react-router-dom';
import { isV2 } from '../version';
export function ResetSent() {
  return (
    <section>
      <h1>Check your email</h1>
      <p>If an account exists for that address, a reset link is on its way.</p>
      {isV2 && <Link to="/">Back to home</Link>}
    </section>
  );
}
