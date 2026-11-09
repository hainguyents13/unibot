import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, File, Image, Paperclip, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { cn } from "@/lib/utils";
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

/**
 * The message box. Enter sends, Shift+Enter adds a line. While the Bot works, a message steers it.
 * Typing `/` opens the Bot's skills and commands.
 */
export function Composer({ thread, view, botName, attachments, onAttach, onRemoveAttachment, onSent }: ComposerProps) {
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const boxId = useId();
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

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(matches[Math.min(highlight, matches.length - 1)].name);
        return;
      }
      if (event.key === "Escape") {
        setMenuClosed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const canAttach = view.canSend && !view.isRunning && !view.isUploading;
  const placeholder = !view.canSend
    ? "Connecting to the chat…"
    : view.isRunning
      ? `${botName} is working. A message now steers the reply.`
      : `Message ${botName}, or type / for skills and commands`;

  return (
    // As wide as the messages above it: their column, plus the same 1.25rem each side.
    <div className="relative mx-auto w-full max-w-[calc(var(--container-3xl)+2.5rem)] px-5 pb-4">
      {matches.length > 0 && (
        <ul
          className="absolute right-5 bottom-full left-5 mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
          role="listbox"
          id="slash-menu"
          aria-label="Skills and commands"
        >
          {matches.map((command, index) => (
            <li
              key={command.name}
              id={`slash-${index}`}
              role="option"
              aria-selected={index === highlight}
              className="flex cursor-pointer items-baseline gap-2 rounded-lg px-3 py-2 aria-selected:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(command.name);
              }}
            >
              <span className="font-mono text-[13px] font-medium">{command.name}</span>
              {command.kind === "skill" && <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">Skill</span>}
              <span className="truncate text-[13px] text-muted-foreground">{command.description}</span>
            </li>
          ))}
        </ul>
      )}
      <PromptInput
        value={text}
        onValueChange={(value) => {
          setText(value);
          setHighlight(0);
          setMenuClosed(false);
        }}
        maxHeight={200} disabled={!view.canSend} className="rounded-2xl bg-card shadow-sm">
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-2 pt-1" aria-label="Attachments">
            {attachments.map((attachment, index) => (
              <li key={`${attachment.name}-${index}`} className="flex items-center gap-1.5 rounded-md border bg-background py-1 pr-1 pl-2 text-xs">
                {attachmentKind(attachment.name) === "image" ? (
                  <Image className="size-3.5 text-muted-foreground" aria-label="Image" />
                ) : (
                  <File className="size-3.5 text-muted-foreground" aria-label="File" />
                )}
                {attachment.name}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveAttachment(index);
                  }}
                >
                  <X className="size-3" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <PromptInputTextarea
          id={boxId}
          className="min-h-10 px-2 text-(length:--chat-text) md:text-(length:--chat-text)"
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length && canAttach) {
              e.preventDefault();
              onAttach(files);
            }
          }}
          placeholder={placeholder}
          aria-label={`Message ${botName}`}
          aria-controls={matches.length ? "slash-menu" : undefined}
          aria-activedescendant={matches.length ? `slash-${highlight}` : undefined}
        />
        <PromptInputActions className="justify-between px-1 pt-1">
          <PromptInputAction tooltip={canAttach ? "Attach files" : "Attach files once the reply has finished"}>
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" aria-label="Attach files" disabled={!canAttach} onClick={() => picker.current?.click()}>
              <Paperclip aria-hidden />
            </Button>
          </PromptInputAction>
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
          <div className="flex items-center gap-1.5">
            {view.isRunning && (
              <PromptInputAction tooltip="Stop">
                <Button type="button" variant="outline" size="icon" className="size-8 rounded-full" aria-label="Stop" onClick={() => thread.stop()}>
                  <Square className="size-3 fill-current" aria-hidden />
                </Button>
              </PromptInputAction>
            )}
            <PromptInputAction tooltip={view.isUploading ? "Sending…" : "Send"}>
              <Button
                type="button"
                size="icon"
                className={cn("size-8 rounded-full", view.isUploading && "animate-pulse")}
                aria-label={view.isUploading ? "Sending…" : "Send"}
                disabled={!canSend}
                onClick={() => void send()}
              >
                <ArrowUp aria-hidden />
              </Button>
            </PromptInputAction>
          </div>
        </PromptInputActions>
      </PromptInput>
    </div>
  );
}
