import { useCallback, useState } from "react";
import type {
  NativeSyntheticEvent,
  TextInputSelectionChangeEventData,
} from "react-native";

import { activeMention, applyMention, SUGGEST_MIN_CHARS } from "./parse";

/**
 * The composer side of @mentions: follows the caret, says which "@…" is
 * being typed (2 characters or more), and puts the picked @username in its
 * place. The caret is only read, never set, so typing feels the same as in
 * any other box.
 */
export function useMentionInput(text: string, setText: (next: string) => void) {
  const [caret, setCaret] = useState<number | null>(null);
  const at = caret === null ? text.length : Math.min(caret, text.length);
  const active = activeMention(text, at);
  const query = active && active.query.length >= SUGGEST_MIN_CHARS ? active.query : null;

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setCaret(event.nativeEvent.selection.end);
    },
    [],
  );

  const pick = useCallback(
    (username: string) => {
      if (!active) {
        return;
      }
      const next = applyMention(text, active, username);
      setText(next.text);
      setCaret(next.caret);
    },
    [active, setText, text],
  );

  return { query, onSelectionChange, pick };
}
