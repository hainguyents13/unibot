import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

/** On is ink, off is the hairline grey; the thumb slides on Beautiful UI's strong ease-out. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-[2px] outline-none transition-[background-color,transform] duration-200 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-ink data-[state=unchecked]:bg-line-strong",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[14px] rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-out-strong data-[state=checked]:translate-x-[12px] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-page"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
