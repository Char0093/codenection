"use client";

import React, { useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";

export function Composer({ onSend, disabled, onTyping }: {
  onSend: (body: string) => void;
  disabled?: boolean;
  /** Called as the field changes. Throttling belongs to the caller, not to every keystroke. */
  onTyping?: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  return <form className="chat-composer" onSubmit={submit}>
    <label className="sr-only" htmlFor="chat-composer-input">Message</label>
    <input id="chat-composer-input" ref={inputRef} type="text" autoComplete="off" maxLength={4000}
      placeholder={disabled ? "Sign in to chat" : "Message the group..."} value={value} disabled={disabled}
      onChange={(event) => {
        setValue(event.target.value);
        // Only announce composing while there is something to compose, so clearing the field
        // does not keep the other members' dots alive.
        if (!disabled && event.target.value.trim()) onTyping?.();
      }} />
    <button type="submit" className="icon-button" disabled={disabled || !value.trim()} aria-label="Send message">
      <Send aria-hidden="true" />
    </button>
  </form>;
}
