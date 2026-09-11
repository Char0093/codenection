import React from "react";
import type { JigsawMember } from "@/features/timeline/jigsaw-panel";

/**
 * Three pulsing dots in an incoming-shaped bubble (ios-chat-design.md §4 "Typing Indicator").
 *
 * Shape and placement come from the ordinary incoming-bubble rules, so it lines up with the
 * thread exactly the way a real message would: leading, grey, tail on the bottom-left. The
 * dots themselves are decorative -- the accessible announcement is the visually hidden
 * sentence, which names who is composing rather than describing the animation.
 */
export function TypingIndicator({ members, typingMemberIds }: {
  members: readonly JigsawMember[];
  typingMemberIds: readonly string[];
}) {
  if (typingMemberIds.length === 0) return null;

  const names = typingMemberIds
    .map((id) => members.find((member) => member.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  const label = names.length === 0
    ? "Someone is typing"
    : names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names[0]} and ${names.length - 1} others are typing`;

  return (
    <li className="chat-message chat-typing" data-self="false" data-group-start="true" aria-hidden="false">
      <p className="chat-message-body chat-typing-bubble">
        <span className="sr-only">{label}</span>
        <span className="chat-typing-dots" aria-hidden="true">
          <span /><span /><span />
        </span>
      </p>
    </li>
  );
}
