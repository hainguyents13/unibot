import * as React from "react"
import { cn } from "@/lib/utils"

/** Beautiful UI's field: a soft filled box with a hairline that firms up and lifts on focus. */
export const fieldClasses =
  "w-full min-w-0 rounded-control bg-field text-ink shadow-hairline outline-none transition-[background-color,box-shadow] duration-150 ease-out placeholder:text-ink-3 hover:shadow-[0_0_0_1px_var(--line-strong)] focus-visible:bg-surface focus-visible:shadow-[0_0_0_1px_var(--line-strong),0_0_0_3px_var(--accent-tint)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:shadow-[0_0_0_1px_var(--red)]"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClasses, "h-8 px-2.5 text-[13.5px]", className)}
      {...props}
    />
  )
}

export { Input }
