import * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> };

function Card({ ref, className, ...props }: DivProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-border/45 bg-card text-card-foreground shadow-[0_1px_0_rgba(255,255,255,0.02)]",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ ref, className, ...props }: DivProps) {
  return <div ref={ref} className={cn("flex flex-col space-y-1 p-4", className)} {...props} />;
}

function CardTitle({ ref, className, ...props }: DivProps) {
  return (
    <div ref={ref} className={cn("text-sm font-medium leading-none tracking-tight", className)} {...props} />
  );
}

function CardDescription({ ref, className, ...props }: DivProps) {
  return <div ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

function CardContent({ ref, className, ...props }: DivProps) {
  return <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
