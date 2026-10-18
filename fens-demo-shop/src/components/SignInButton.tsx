import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
export function SignInButton() {
  const { user, logout } = useAuth();
  if (user) {
    return (
      <span className="sign-in-button user-badge" data-component="SignInButton">
        <span>{user.name}</span>
        <button
          type="button"
          onClick={() => void logout()}
          style={{
            marginLeft: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          Sign out
        </button>
      </span>
    );
  }
  return (
    <Link to="/login" className="sign-in-button" data-component="SignInButton">
      Sign in
    </Link>
  );
}
