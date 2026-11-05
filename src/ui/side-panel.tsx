import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A panel over the right of the chat, such as a Bot's routines. */
export function SidePanel({ title, label, onClose, children }: { title: string; label: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-[min(360px,100%)] flex-col gap-3 overflow-y-auto border-l bg-background p-4 shadow-[-8px_0_24px_rgb(0_0_0/0.08)]"
      aria-label={label}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>
      {children}
    </aside>
  );
}
