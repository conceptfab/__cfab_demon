import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-xs font-medium leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-[color,background-color,border-color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary/14 text-foreground hover:border-primary/45 hover:bg-primary/20",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/35 hover:bg-destructive/16",
        outline:
          "border-input bg-card/70 text-foreground hover:border-border hover:bg-accent/75 hover:text-accent-foreground",
        secondary:
          "border-border/75 bg-secondary/90 text-secondary-foreground hover:border-border hover:bg-accent/70 hover:text-accent-foreground",
        ghost:
          "border-transparent bg-transparent text-muted-foreground shadow-none hover:border-border/65 hover:bg-accent/60 hover:text-foreground",
        link:
          "h-auto border-0 rounded-none bg-transparent px-0 py-0 text-foreground shadow-none hover:text-card-foreground hover:underline underline-offset-4",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 rounded-md px-2.5 text-[11px]",
        lg: "h-9 rounded-md px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
