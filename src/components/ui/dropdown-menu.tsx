import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import GlideMenu from "@/components/primitives/GlideMenu"
import { cn } from "@/lib/utils"

// shadcn/ui's dropdown menu (new-york), written by hand rather than by `shadcn add`; only the parts
// Unibot uses. It looks like Beautiful UI's menus: a raised surface that pops in, and one highlight
// (GlideMenu) that glides to the item under the pointer or the keyboard's focus.

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({ className, sideOffset = 6, children, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[10px] bg-surface p-1 text-ink shadow-raised outline-none",
          "data-[state=open]:animate-[pop-in_180ms_cubic-bezier(0.23,1,0.32,1)_both] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100",
          className
        )}
        {...props}
      >
        <GlideMenu rowSelector="[data-slot=dropdown-menu-item]:not([data-disabled])" highlightClassName="inset-x-0 rounded-[6px] bg-hover" className="flex flex-col">
          {children}
        </GlideMenu>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: "default" | "destructive" }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        "relative z-10 flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[13px] text-ink outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[variant=destructive]:text-red [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-ink-2 data-[variant=destructive]:*:[svg]:!text-red",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn("my-1 h-px bg-line", className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
}
