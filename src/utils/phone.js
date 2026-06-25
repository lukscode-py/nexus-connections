export function normalizePhone(input) {
  return String(input || "").replace(/\D/g, "");
}

export function isValidInternationalPhone(input) {
  const phone = normalizePhone(input);
  return phone.length >= 10 && phone.length <= 15 && !phone.startsWith("0");
}

export function maskPhone(phone) {
  const value = normalizePhone(phone);
  if (value.length < 6) return value;
  return `${value.slice(0, 4)}****${value.slice(-3)}`;
}
