import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Session, SessionState } from "../hermes/session";

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
    <section className="recent-gateways" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul>
        {gateways.map((gateway) => (
          <li key={gateway}>
            <button type="button" className="recent-open" onClick={() => onOpen(gateway)}>
              {gateway}
            </button>
            <button type="button" className="icon-button" aria-label={`Forget ${gateway}`} title="Forget, and remove its saved sign-in" onClick={() => onForget(gateway)}>
              <X size={16} aria-hidden />
            </button>
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
    <main className="connect">
      <h1>Unibot</h1>
      <p>Sign in to your Hermes gateway to chat with your Bots.</p>
      <form className="connect-form" onSubmit={submit}>
        <label htmlFor="gateway-address">Gateway address</label>
        <input
          id="gateway-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="100.101.102.103:9119"
          autoComplete="off"
          spellCheck={false}
          disabled={signingIn}
          autoFocus
        />
        <p className="hint">
          Where <code>hermes dashboard</code> runs, for example your VPS's Tailscale address and port 9119. The
          dashboard needs a sign-in set up.
        </p>
        {signingIn ? (
          <div className="connect-actions">
            <p role="status">Finish signing in in your browser.</p>
            <button type="button" onClick={() => session.cancelSignIn()}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="connect-actions">
            <button type="submit" className="primary">
              Sign in
            </button>
          </div>
        )}
        {state.kind === "signedOut" && state.problem && (
          <p className="problem" role="alert">
            {state.problem}
          </p>
        )}
      </form>
      {!signingIn && <RecentGateways title="Recently used" gateways={recent} onOpen={open} onForget={(gateway) => void session.forgetGateway(gateway)} />}
      <p className="independence">Unibot is independent: not made by, affiliated with or endorsed by Nous Research.</p>
    </main>
  );
}
