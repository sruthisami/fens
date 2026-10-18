import type { ButtonHTMLAttributes } from 'react';
export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="btn-primary" data-component="PrimaryButton" {...props} />;
}
