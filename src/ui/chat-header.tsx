import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The top of a chat or room: its name, a line under it, and its tools on the right. */
export function ChatHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="flex min-h-13 items-center justify-between gap-3 border-b border-line px-5 py-2">
      <div className="min-w-0" style={{ animation: "fade-in 200ms ease-out both" }} key={title}>
        <h2 className="truncate text-[14px] leading-tight font-medium text-ink">{title}</h2>
        {subtitle && <p className="truncate text-[12.5px] text-ink-3">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-0.5">{children}</div>}
    </header>
  );
}

/** A quiet header button with an icon (Beautiful UI's toolbar buttons); narrow windows keep the icon and drop the words. */
export function HeaderTool({ icon, label, pressed, className, ...props }: { icon: ReactNode; label: string; pressed?: boolean } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={label}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-control px-2 text-[12.5px] font-medium text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.96] aria-pressed:bg-field aria-pressed:text-ink aria-pressed:shadow-hairline max-[720px]:w-7 max-[720px]:justify-center max-[720px]:px-0 [&_svg]:size-[15px] [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="max-[720px]:sr-only">{label}</span>
    </button>
  );
}
