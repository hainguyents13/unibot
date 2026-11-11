import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import PromptBar from "@/components/primitives/PromptBar";
import { attachmentKind, type Attachment } from "../hermes/attachments";
import type { ChatThread, ChatView } from "../hermes/chat-thread";
import { matchingCommands } from "../hermes/commands";

interface ComposerProps {
  thread: ChatThread;
  view: ChatView;
  botName: string;
  attachments: Attachment[];
  onAttach(files: FileList | File[]): void;
  onRemoveAttachment(index: number): void;
  onSent(): void;
}

/** As wide as the messages above it: their column, plus the same 1.25rem each side. */
export function ComposerColumn({ children }: { children: ReactNode }) {
  return <div className="relative mx-auto w-full max-w-[calc(var(--container-3xl)+2.5rem)] px-5 pb-4">{children}</div>;
}

/**
 * The message box (Beautiful UI's PromptBar). Enter sends, Shift+Enter adds a line. While the Bot
 * works, a message steers it. Typing `/` opens the Bot's skills and commands.
 */
export function Composer({ thread, view, botName, attachments, onAttach, onRemoveAttachment, onSent }: ComposerProps) {
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const boxId = useId();
  const menuId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const matches = menuClosed ? [] : matchingCommands(text, view.commands).slice(0, 8);
  const focusBox = () => document.getElementById(boxId)?.focus();

  // A command such as /retry hands text back to edit.
  useEffect(() => {
    if (view.prefill === undefined) return;
    const prefill = thread.takePrefill();
    if (prefill !== undefined) setText(prefill);
    focusBox();
    // focusBox reads the box by its ID, which doesn't change.
  }, [view.prefill, thread]);

  const canSend = view.canSend && !view.isUploading && (text.trim() !== "" || attachments.length > 0);

  async function send() {
    if (!canSend) return;
    if (attachments.length > 0) {
      // On a failed upload the draft stays, and the chat says which file and why.
      if (await thread.sendWithAttachments(text, attachments)) {
        setText("");
        onSent();
      }
      return;
    }
    thread.send(text);
    setText("");
  }

  function pick(name: string) {
    setText(`${name} `);
    setMenuClosed(true);
    focusBox();
  }

  /** The menu's keys; anything left goes on to the box, where Enter sends. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => (h + step + matches.length) % matches.length);
    } else if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
      event.preventDefault();
      pick(matches[Math.min(highlight, matches.length - 1)].name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMenuClosed(true);
    }
  }

  const canAttach = view.canSend && !view.isRunning && !view.isUploading;
  const placeholder = !view.canSend
    ? "Connecting to the chat…"
    : view.isRunning
      ? `${botName} is working. A message now steers the reply.`
      : `Message ${botName}, or type / for skills and commands`;

  return (
    <ComposerColumn>
      <PromptBar
        value={text}
        onValueChange={(value) => {
          setText(value);
          setHighlight(0);
          setMenuClosed(false);
        }}
        onSubmit={() => void send()}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length && canAttach) {
            e.preventDefault();
            onAttach(files);
          }
        }}
        placeholder={placeholder}
        ariaLabel={`Message ${botName}`}
        textareaId={boxId}
        disabled={!view.canSend}
        menu={
          matches.length > 0
            ? {
                id: menuId,
                label: "Skills and commands",
                rows: matches.map((command) => ({
                  key: command.name,
                  name: command.name,
                  desc: command.description,
                  tag: command.kind === "skill" ? "Skill" : undefined,
                })),
                active: Math.min(highlight, matches.length - 1),
                onHover: setHighlight,
                onPick: (index) => pick(matches[index].name),
                hint: "Type to search commands",
              }
            : undefined
        }
        attachments={attachments.map((attachment) => ({ name: attachment.name, kind: attachmentKind(attachment.name) === "image" ? "image" : "file" }))}
        onRemoveAttachment={onRemoveAttachment}
        attach={{
          label: canAttach ? "Attach files" : "Attach files once the reply has finished",
          disabled: !canAttach,
          onClick: () => picker.current?.click(),
        }}
        stop={view.isRunning ? { label: "Stop", onClick: () => thread.stop() } : undefined}
        canSend={canSend}
        sending={view.isUploading}
      />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAttach(e.target.files);
          e.target.value = "";
        }}
      />
    </ComposerColumn>
  );
}
