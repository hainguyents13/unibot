import { cn } from "@/lib/utils";

/** A Bot's or room's initial in a circle; rooms pass `mark` instead. */
export function Avatar({ name, mark, className }: { name: string; mark?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-input text-[13px] font-semibold text-foreground", className)}
    >
      {mark ?? name.slice(0, 1).toUpperCase()}
    </span>
  );
}
