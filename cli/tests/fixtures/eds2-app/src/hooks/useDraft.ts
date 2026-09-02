import { useLocalStorage } from "@sds-eng/base-exp";

export interface Draft {
  login: string;
  updatedAt: number;
}

/** Keeps the half-filled login form between reloads. */
export const useDraft = (): readonly [Draft, (next: Draft) => void] =>
  useLocalStorage<Draft>("eds2-app:draft", { login: "", updatedAt: 0 });
