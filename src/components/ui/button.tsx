import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { buttonVariants as beautifulButton } from "@/components/atoms/Button"
import { cn } from "@/lib/utils"

/*
 * Unibot's button: Beautiful UI's pill Button (`components/atoms/Button.tsx`) under shadcn/ui's
 * names, so `variant="outline"` and `asChild` keep working, plus square icon sizes in its style.
 */

const filledShadow = "shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"

const VARIANTS = {
  default: beautifulButton({ variant: "primary", size: null }),
  accent: beautifulButton({ variant: "accent", size: null }),
  destructive: cn(beautifulButton({ variant: "primary", size: null }), `bg-red text-white hover:opacity-100 hover:brightness-95 dark:bg-red dark:text-white ${filledShadow}`),
  outline: beautifulButton({ variant: "secondary", size: null }),
  secondary: beautifulButton({ variant: "ghost", size: null }),
  ghost: beautifulButton({ variant: "quiet", size: null }),
  link: "text-accent-ink underline-offset-4 hover:underline",
}

const buttonVariants = cva(
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: VARIANTS,
      size: {
        default: "px-4 py-[9px] text-sm leading-none rounded-full gap-2",
        xs: "h-7 rounded-full px-2.5 text-[12px] leading-none gap-1 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-[27px] px-3 text-[13px] leading-none rounded-full gap-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "px-5 py-[11px] text-sm leading-none rounded-full gap-2",
        icon: "size-8 rounded-control",
        "icon-xs": "size-6 rounded-[6px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-control",
        "icon-lg": "size-9 rounded-control",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
