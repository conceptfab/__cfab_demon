import type { ReactNode } from 'react';

interface ClientsFormFieldProps {
  label: string;
  children: ReactNode;
}

export function ClientsFormField({ label, children }: ClientsFormFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
