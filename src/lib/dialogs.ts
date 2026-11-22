import { Alert, Platform } from "react-native";

/**
 * Dialogs that work on every platform. React Native Web's `Alert.alert` does
 * nothing, so on web (app.bumelerze.com, the phone-testing channel) every
 * confirm silently failed — "Replay onboarding" in Settings looked dead
 * (owner, 2026-10-05). Web uses the browser's own `confirm`/`alert`;
 * native keeps the system dialog.
 */

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** Omit for a one-button notice whose only button still runs `onConfirm`. */
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Runs when the person cancels (Cancel, or Android's Back while the
   * dialog is open). Optional: without it a cancel simply does nothing. */
  onCancel?: () => void;
}

export function confirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogOptions): void {
  if (Platform.OS === "web") {
    const text = `${title}\n\n${message}`;
    if (cancelLabel === undefined) {
      globalThis.alert?.(text);
      onConfirm();
      return;
    }
    if (globalThis.confirm?.(text)) {
      onConfirm();
    } else {
      onCancel?.();
    }
    return;
  }
  const buttons = [
    ...(cancelLabel === undefined
      ? []
      : [
          onCancel
            ? { text: cancelLabel, style: "cancel" as const, onPress: onCancel }
            : { text: cancelLabel, style: "cancel" as const },
        ]),
    {
      text: confirmLabel,
      style: destructive ? ("destructive" as const) : ("default" as const),
      onPress: onConfirm,
    },
  ];
  if (onCancel && cancelLabel !== undefined) {
    // Android's Back closes the dialog without a button: that is a cancel too.
    Alert.alert(title, message, buttons, { cancelable: true, onDismiss: onCancel });
    return;
  }
  Alert.alert(title, message, buttons);
}

/** A plain notice with a single OK. */
export function messageDialog(title: string, message: string): void {
  if (Platform.OS === "web") {
    globalThis.alert?.(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
