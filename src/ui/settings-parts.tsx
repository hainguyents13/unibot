import type { ComponentProps, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The pieces Settings pages are made of, so they all look alike: Beautiful UI's cards and labels. */

export function PageTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-semibold text-ink">{children}</h3>;
}

/** Beautiful UI's quiet group label. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h4 className={cn("mt-2 text-[12.5px] font-medium text-ink-3", className)}>{children}</h4>;
}

export function Note({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[13px] text-ink-2", className)} {...props} />;
}

export function Problem({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("text-[13px] text-red", className)} {...props} />;
}

/** Your say-so to send a key or token over plain http, which others on the network could read. */
export function Consent({ checked, onChange, what = "what you send" }: { checked: boolean; onChange: (checked: boolean) => void; what?: string }) {
  return (
    <label className="flex items-start gap-2.5 rounded-control bg-orange-tint p-2.5 text-[13px] text-ink">
      <Checkbox className="mt-0.5" checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <span>This gateway uses plain http outside Tailscale, so others on the network could read {what}. Send it anyway.</span>
    </label>
  );
}

/** A label above its input, with help underneath. */
export function Field({ label, htmlFor, help, children }: { label: string; htmlFor: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help && <span className="text-[12px] text-ink-3">{help}</span>}
    </div>
  );
}

/** A card for one thing: an app, a connector, the gateway. */
export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("primitive-card-pad flex flex-col gap-2 rounded-card bg-surface shadow-card", className)} {...props} />;
}

/**
 * Beautiful UI's segmented control: a filled track whose picked segment is a raised surface. A
 * radio group, so arrow keys and screen readers treat it as one choice.
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex w-fit rounded-full bg-field p-0.5", className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-3.5",
              on ? "bg-surface text-ink shadow-btn" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
