import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
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
      <ul className="divide-y rounded-lg border">
        {gateways.map((gateway) => (
          <li key={gateway} className="flex items-center gap-1 pr-1.5">
            <button
              type="button"
              className="min-w-0 flex-1 truncate rounded-lg border-0 bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-accent"
              onClick={() => onOpen(gateway)}
            >
              {gateway}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={`Forget ${gateway}`}
              title="Forget, and remove its saved sign-in"
              onClick={() => onForget(gateway)}
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
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
    <main className="mx-auto my-20 flex w-full max-w-md flex-col gap-2 px-4">
      <h1 className="text-2xl font-semibold">Unibot</h1>
      <p className="text-muted-foreground">Sign in to your Hermes gateway to chat with your Bots.</p>
      <form className="mt-4 grid gap-2" onSubmit={submit}>
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
        <Note className="text-xs">
          Where <code>hermes dashboard</code> runs, for example your VPS's Tailscale address and port 9119. The dashboard needs a sign-in set up.
        </Note>
        <div className="mt-2 flex items-center gap-3">
          {signingIn ? (
            <>
              <p role="status">Finish signing in in your browser.</p>
              <Button type="button" variant="outline" onClick={() => session.cancelSignIn()}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="submit">Sign in</Button>
          )}
        </div>
        {state.kind === "signedOut" && state.problem && <Problem>{state.problem}</Problem>}
      </form>
      {!signingIn && <RecentGateways title="Recently used" gateways={recent} onOpen={open} onForget={(gateway) => void session.forgetGateway(gateway)} />}
      <Note className="mt-6 text-xs">Unibot is independent: not made by, affiliated with or endorsed by Nous Research.</Note>
    </main>
  );
}
