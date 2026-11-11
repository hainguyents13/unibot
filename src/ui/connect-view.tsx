import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import GlideMenu from "@/components/primitives/GlideMenu";
import LoadingState from "@/components/primitives/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Session, SessionState } from "../hermes/session";
import { Note, Problem, SectionTitle } from "./settings-parts";

interface ConnectViewProps {
  session: Session;
  state: Extract<SessionState, { kind: "signedOut" | "signingIn" }>;
}

/** Gateways signed in to before: open one, or forget it along with its saved sign-in. */
export function RecentGateways({
  title,
  gateways,
  onOpen,
  onForget,
}: {
  title: string;
  gateways: string[];
  onOpen: (gateway: string) => void;
  onForget: (gateway: string) => void;
}) {
  const id = useId();
  if (gateways.length === 0) return null;
  return (
    <section className="mt-2 flex flex-col gap-1.5" aria-labelledby={id}>
      <SectionTitle>
        <span id={id}>{title}</span>
      </SectionTitle>
      <GlideMenu rowSelector="[data-menu-row]" highlightClassName="inset-x-0 rounded-control bg-hover" className="rounded-card bg-surface p-1 shadow-card">
        <ul className="flex flex-col gap-px">
          {gateways.map((gateway) => (
            <li key={gateway} data-menu-row className="group relative z-10 flex items-center gap-1 rounded-control pr-1">
              <button
                type="button"
                className="min-w-0 flex-1 truncate rounded-control px-2.5 py-2 text-left text-[13.5px] font-medium text-ink transition-transform duration-150 active:scale-[0.99]"
                onClick={() => onOpen(gateway)}
              >
                {gateway}
              </button>
              <button
                type="button"
                className="primitive-icon-button shrink-0 text-ink-3 opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-hover-2 hover:text-ink"
                aria-label={`Forget ${gateway}`}
                title="Forget, and remove its saved sign-in"
                onClick={() => onForget(gateway)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </GlideMenu>
    </section>
  );
}

export function ConnectView({ session, state }: ConnectViewProps) {
  const [address, setAddress] = useState(state.kind === "signedOut" ? state.address : state.gateway.baseUrl);
  const signingIn = state.kind === "signingIn";
  const recent = session.recentGateways();

  function submit(event: FormEvent) {
    event.preventDefault();
    void session.signIn(address);
  }

  function open(gateway: string) {
    setAddress(gateway);
    void session.signIn(gateway);
  }

  return (
    <div className="flex min-h-screen items-start justify-center overflow-y-auto bg-canvas px-4 py-16">
      <main className="flex w-full max-w-md flex-col gap-1.5 rounded-window bg-surface p-6 shadow-overlay animate-[fade-up_420ms_cubic-bezier(0.23,1,0.32,1)_both]">
        <h1 className="text-xl font-semibold text-ink">Unibot</h1>
        <p className="text-[13.5px] text-ink-2">Sign in to your Hermes gateway to chat with your Bots.</p>
        <form className="mt-4 grid gap-1.5" onSubmit={submit}>
          <Label htmlFor="gateway-address">Gateway address</Label>
          <Input
            id="gateway-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="100.101.102.103:9119"
            autoComplete="off"
            spellCheck={false}
            disabled={signingIn}
            autoFocus
          />
          <Note className="text-[12px] text-ink-3">
            Where <code className="rounded-chip bg-field px-1 font-mono text-[11.5px] text-ink">hermes dashboard</code> runs, for example your VPS's Tailscale
            address and port 9119. The dashboard needs a sign-in set up.
          </Note>
          <div className="mt-3 flex min-h-8 items-center justify-between gap-3">
            {signingIn ? (
              <>
                <LoadingState label="Waiting for your browser" />
                <Button type="button" variant="outline" size="sm" onClick={() => session.cancelSignIn()}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button type="submit">Sign in</Button>
            )}
          </div>
          {signingIn && <Note className="text-[12px] text-ink-3">Finish signing in in your browser.</Note>}
          {state.kind === "signedOut" && state.problem && <Problem className="animate-[fade-up_300ms_cubic-bezier(0.23,1,0.32,1)_both]">{state.problem}</Problem>}
        </form>
        {!signingIn && <RecentGateways title="Recently used" gateways={recent} onOpen={open} onForget={(gateway) => void session.forgetGateway(gateway)} />}
        <Note className="mt-6 text-[12px] text-ink-3">Unibot is independent: not made by, affiliated with or endorsed by Nous Research.</Note>
      </main>
    </div>
  );
}
