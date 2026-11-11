import { useState, type FormEvent, type ReactNode } from "react";
import { Blocks, Bot as BotIcon, LogOut, Palette, Server } from "lucide-react";
import GlideMenu from "@/components/primitives/GlideMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { GatewayAddress } from "../hermes/gateway-address";
import { describeError } from "../hermes/gateway-error";
import type { Link, Session, SessionState } from "../hermes/session";
import { AppsSettings } from "./apps-settings";
import { ComposioSettings } from "./composio-settings";
import { AppearanceSettings } from "./appearance-settings";
import { RecentGateways } from "./connect-view";
import { Note, PageTitle, Panel, Problem, SectionTitle } from "./settings-parts";

export type SettingsPage = { kind: "gateway" } | { kind: "appearance" } | { kind: "composio" } | { kind: "apps"; botId: string };

interface SettingsDialogProps {
  session: Session;
  state: Extract<SessionState, { kind: "signedIn" }>;
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  onClose: () => void;
}

/** Settings: the gateway, Composio and each Bot's apps, with a page list on the left. */
export function SettingsDialog({ session, state, page, onPage, onClose }: SettingsDialogProps) {
  const bot = page.kind === "apps" ? state.bots.find((b) => b.id === page.botId) : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(640px,calc(100vh-3rem))] w-[min(880px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <header className="flex items-center border-b border-line px-5 py-3.5">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">The gateway, how chats look, Composio, and each Bot's apps.</DialogDescription>
        </header>
        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <nav
            className="w-52 shrink-0 overflow-y-auto border-r border-line bg-canvas p-2 max-sm:w-auto max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b"
            aria-label="Settings pages"
          >
            {/* One highlight glides between the pages (Beautiful UI's GlideMenu); a narrow window
                lays them out in a row, where each row shows its own hover instead. */}
            <GlideMenu
              rowSelector="[data-menu-row]"
              highlightClassName="inset-x-0 rounded-[8px] bg-hover-2 max-sm:hidden"
              className="flex flex-col gap-px max-sm:flex-row max-sm:items-center"
            >
            <NavItem icon={<Server />} current={page.kind === "gateway"} onClick={() => onPage({ kind: "gateway" })}>
              Gateway
            </NavItem>
            <NavItem icon={<Palette />} current={page.kind === "appearance"} onClick={() => onPage({ kind: "appearance" })}>
              Appearance
            </NavItem>
            <NavItem icon={<Blocks />} current={page.kind === "composio"} onClick={() => onPage({ kind: "composio" })}>
              Composio
            </NavItem>
            <SectionTitle className="mx-2 mt-4 mb-1 shrink-0 whitespace-nowrap max-sm:my-0">Apps of each Bot</SectionTitle>
            {state.bots.map((b) => (
              <NavItem key={b.id} icon={<BotIcon />} current={page.kind === "apps" && page.botId === b.id} onClick={() => onPage({ kind: "apps", botId: b.id })}>
                {b.name}
              </NavItem>
            ))}
            {state.bots.length === 0 && <Note className="mx-2">No Bots yet.</Note>}
            </GlideMenu>
          </nav>
          <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5 max-sm:px-4">
            <div key={pageKey(page)} className="flex flex-col gap-3 animate-[fade-up_300ms_cubic-bezier(0.23,1,0.32,1)_both]">
            {page.kind === "gateway" && <GatewaySettings session={session} state={state} />}
            {page.kind === "appearance" && <AppearanceSettings />}
            {page.kind === "composio" && <ComposioSettings session={session} bots={state.bots} />}
            {page.kind === "apps" &&
              (bot ? (
                <>
                  <PageTitle>{bot.name}'s apps</PageTitle>
                  <Note>Each Bot has its own apps, kept on the gateway with their keys and sign-ins.</Note>
                  <AppsSettings key={bot.id} apps={session.apps(bot.id)} botName={bot.name} />
                </>
              ) : (
                <Note>That Bot isn't on this gateway any more.</Note>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NavItem({ icon, current, onClick, children }: { icon: ReactNode; current: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      data-menu-row
      className={cn(
        "relative z-10 flex h-8 shrink-0 items-center gap-2 rounded-control px-2 text-left text-[13.5px] font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.98] max-sm:hover:bg-hover [&_svg]:size-4 [&_svg]:shrink-0",
        current ? "bg-hover-2 text-ink sm:group-hover/glide-menu:bg-transparent [&_svg]:text-ink" : "text-ink-2 [&_svg]:text-ink-3",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

function GatewaySettings({ session, state }: { session: Session; state: SettingsDialogProps["state"] }) {
  const current = state.gateway.baseUrl;
  const others = session.recentGateways().filter((gateway) => gateway !== current);
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string>();

  function switchTo(event: FormEvent) {
    event.preventDefault();
    try {
      GatewayAddress.parse(address);
    } catch (error) {
      return setProblem(describeError(error));
    }
    void session.switchGateway(address.trim());
  }

  return (
    <>
      <PageTitle>Gateway</PageTitle>
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-[13.5px] font-medium break-all text-ink">{current}</span>
          {!state.demo && (
            <Button type="button" variant="outline" size="sm" onClick={() => void session.signOut()}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          )}
        </div>
        <Note>{state.demo ? "The demo: a made-up gateway, and nothing connects." : linkText(state.link)}</Note>
      </Panel>
      {!state.demo && (
        <>
          <Note className="text-[12px] text-ink-3">Signing out removes this gateway's saved sign-in from this computer. Switching to another gateway keeps it.</Note>
          <RecentGateways
            title="Switch to"
            gateways={others}
            onOpen={(gateway) => void session.switchGateway(gateway)}
            onForget={(gateway) => void session.forgetGateway(gateway)}
          />
          <form className="mt-2 grid gap-2" onSubmit={switchTo}>
            <Label htmlFor="other-gateway">Another gateway</Label>
            <div className="flex gap-2">
              <Input
                id="other-gateway"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setProblem(undefined);
                }}
                placeholder="100.101.102.103:9119"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" variant="outline" disabled={!address.trim()}>
                Switch
              </Button>
            </div>
            {problem && <Problem>{problem}</Problem>}
            <Note className="text-[12px] text-ink-3">A gateway you haven't used here signs in on its page in your browser.</Note>
          </form>
        </>
      )}
    </>
  );
}

/** Each page fades in when you switch to it. */
function pageKey(page: SettingsPage): string {
  return page.kind === "apps" ? `apps:${page.botId}` : page.kind;
}

function linkText(link: Link): string {
  switch (link.kind) {
    case "online":
      return "Connected.";
    case "connecting":
      return "Connecting…";
    case "offline":
      return `${link.message} Trying again…`;
  }
}
