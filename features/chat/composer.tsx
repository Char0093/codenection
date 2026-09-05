"use client";

import React, { useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";

export function Composer({ onSend, disabled }: { onSend: (body: string) => void; disabled?: boolean }) {
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
      onChange={(event) => setValue(event.target.value)} />
    <button type="submit" className="icon-button" disabled={disabled || !value.trim()} aria-label="Send message">
      <Send aria-hidden="true" />
    </button>
  </form>;
}
