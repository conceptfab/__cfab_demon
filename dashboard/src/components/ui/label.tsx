import * as React from "react"
import { cn } from "@/lib/utils"

type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  ref?: React.Ref<HTMLLabelElement>
}

function Label({ ref, className, ...props }: LabelProps) {
  return (
    // Generic label wrapper — callers must pass htmlFor or nest a control.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control, react-doctor/label-has-associated-control
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    />
  )
}

export { Label }
