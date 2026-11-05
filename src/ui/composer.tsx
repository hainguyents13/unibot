import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const matches = menuClosed ? [] : matchingCommands(text, view.commands).slice(0, 8);

  // Grows with the text, up to the CSS max-height.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // A command such as /retry hands text back to edit.
  useEffect(() => {
    if (view.prefill === undefined) return;
    const prefill = thread.takePrefill();
    if (prefill !== undefined) setText(prefill);
    box.current?.focus();
  }, [view.prefill, thread]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!view.canSend || (!text.trim() && attachments.length === 0)) return;
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
    box.current?.focus();
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) void send(event);
  }

  const canAttach = view.canSend && !view.isRunning && !view.isUploading;
  const placeholder = !view.canSend
    ? "Connecting to the chat…"
    : view.isRunning
      ? `${botName} is working. A message now steers the reply.`
      : `Message ${botName}, or type / for skills and commands`;

  return (
    <form className="composer" onSubmit={send}>
      {matches.length > 0 && (
        <ul className="slash-menu" role="listbox" id="slash-menu" aria-label="Skills and commands">
          {matches.map((command, index) => (
            <li
              key={command.name}
              id={`slash-${index}`}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(command.name);
              }}
            >
              <span className="slash-name">{command.name}</span>
              {command.kind === "skill" && <span className="slash-kind">Skill</span>}
              <span className="slash-description">{command.description}</span>
            </li>
          ))}
        </ul>
      )}
      {attachments.length > 0 && (
        <ul className="pending" aria-label="Attachments">
          {attachments.map((attachment, index) => (
            <li key={`${attachment.name}-${index}`} className="chip">
              <span className="chip-kind">{attachmentKind(attachment.name) === "image" ? "Image" : "File"}</span>
              {attachment.name}
              <button type="button" className="chip-remove" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(index)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button
          type="button"
          className="attach"
          aria-label="Attach files"
          title={canAttach ? "Attach files" : "Attach files once the reply has finished"}
          disabled={!canAttach}
          onClick={() => picker.current?.click()}
        >
          +
        </button>
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
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(0);
            setMenuClosed(false);
          }}
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
          disabled={!view.canSend}
        />
        {view.isRunning && (
          <button type="button" onClick={() => thread.stop()}>
            Stop
          </button>
        )}
        <button type="submit" className="primary" disabled={!view.canSend || view.isUploading || (!text.trim() && attachments.length === 0)}>
          {view.isUploading ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
