/**
 * D-041 (temporary, Nasser's experiment): with VITE_COMPANY_PAGE=1 every address is the page of Azm
 * Spark Establishment (mobile app and augmented reality development, a contact email, the national
 * number). Nothing else is removed: unset the variable and redeploy to bring back the coming soon page.
 */
export const COMPANY_PAGE = import.meta.env.VITE_COMPANY_PAGE === "1";
/** The contact email shown on the page (VITE_COMPANY_EMAIL). */
export const COMPANY_EMAIL = (import.meta.env.VITE_COMPANY_EMAIL as string | undefined)?.trim() || "";
