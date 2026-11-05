import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** The top of a chat or room: its name, a line under it, and its tools on the right. */
export function ChatHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">{title}</h2>
        {subtitle && <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 gap-0.5">{children}</div>}
    </header>
  );
}

/** A quiet header button with an icon; narrow windows keep the icon and drop the words. */
export function HeaderTool({ icon, label, pressed, ...props }: { icon: ReactNode; label: string; pressed?: boolean } & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      title={label}
      className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
      {...props}
    >
      {icon}
      <span className="max-[720px]:sr-only">{label}</span>
    </Button>
  );
}
