import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

export interface NeuCardProps extends React.HTMLAttributes<HTMLDivElement> {
  raise?: boolean
  asChild?: boolean
}

const NeuCard = React.forwardRef<HTMLDivElement, NeuCardProps>(
  ({ className, raise = true, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return (
      <Comp
        ref={ref}
        className={cn(
          "relative rounded-lg border-0 bg-card text-card-foreground transition-all duration-200 neu-raised group",
          raise && "neu-raised-hover",
          className
        )}
        {...props}
      />
    )
  }
)
NeuCard.displayName = "NeuCard"

export { NeuCard }
