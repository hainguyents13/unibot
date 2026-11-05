import type { ComponentProps, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The pieces Settings pages are made of, so they all look alike. */

export function PageTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h4 className={cn("mt-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase", className)}>{children}</h4>;
}

export function Note({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[13px] text-muted-foreground", className)} {...props} />;
}

export function Problem({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("text-[13px] text-destructive", className)} {...props} />;
}

/** Your say-so to send a key or token over plain http, which others on the network could read. */
export function Consent({ checked, onChange, what = "what you send" }: { checked: boolean; onChange: (checked: boolean) => void; what?: string }) {
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-attention/40 bg-attention-soft/50 p-2.5 text-[13px]">
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
      {help && <span className="text-xs text-muted-foreground">{help}</span>}
    </div>
  );
}

/** A bordered box for one thing: an app, a connector, the gateway. */
export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 rounded-lg border bg-card p-3", className)} {...props} />;
}
