import { isCashBankPostingError } from "@/lib/cash-bank";
import { WhtReceivedUserError } from "@/lib/wht-received";

/**
 * User-fixable conditions raised by the helpers several document Server Actions
 * share (cash/bank posting rules, withholding-tax record). Their message is
 * written for users, so an action returns it as-is — without reportCriticalError,
 * which is reserved for system failures.
 */
export function isUserFacingDocumentError(err: unknown): err is Error {
  return isCashBankPostingError(err) || err instanceof WhtReceivedUserError;
}
