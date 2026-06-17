import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
  {
    variants: {
      variant: {
        default: 'border-primary/20 bg-primary/15 text-foreground',
        secondary: 'border-border/70 bg-secondary/70 text-secondary-foreground',
        destructive: 'border-destructive/20 bg-destructive/15 text-destructive',
        outline: 'border-border/70 bg-transparent text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
