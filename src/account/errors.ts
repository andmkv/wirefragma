import { en } from "../i18n/en";
import type { TranslationKey, TranslationParams } from "../i18n";
import { ApiError } from "./api";

/** Localized message for an API failure: a known error code wins over the server's English text. */
export function errorMessage(
  t: (key: TranslationKey, params?: TranslationParams) => string,
  error: unknown
): string {
  if (error instanceof ApiError) {
    const key = `error.${error.code}`;
    if (key in en) return t(key as TranslationKey);
  }
  return error instanceof Error ? error.message : String(error);
}
