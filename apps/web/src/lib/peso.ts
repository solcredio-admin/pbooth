/** Centavos as money: 15000 → ₱150. */
export const peso = (centavos: number, currency = "PHP") => new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: centavos % 100 ? 2 : 0 }).format(centavos / 100);
