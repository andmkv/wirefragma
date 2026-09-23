/**
 * One place that answers "is the user typing right now?".
 *
 * Every global shortcut in the editor (Delete, Cmd+C/V/D, arrows, zoom) must stay out of the
 * way while a text field, textarea or contentEditable control owns the keyboard.
 */

export function isEditingTextInput(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as HTMLElement;
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (element as HTMLInputElement).type;
  // Number/text fields are editable; buttons/checkboxes/radios inside a form are not typing.
  return type !== "button" && type !== "checkbox" && type !== "radio" && type !== "submit" && type !== "range" && type !== "color";
}
