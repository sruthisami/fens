interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  placeholderOnly?: boolean;
}
export function FormField({
  id,
  label,
  type = 'text',
  autoComplete,
  defaultValue,
  placeholderOnly = false,
}: FormFieldProps) {
  return (
    <div className="field" data-component="FormField">
      {!placeholderOnly && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        placeholder={placeholderOnly ? label : undefined}
      />
    </div>
  );
}
