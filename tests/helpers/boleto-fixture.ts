// Synthetic boleto: no real supplier, account or payment document.
export function boletoFixture(dueDate = "2026-10-10", amountCents = 300000) {
  const factor = 1000 + (new Date(`${dueDate}T00:00:00Z`).getTime() - Date.UTC(2025, 1, 22)) / 86400000;
  const tail = String(factor).padStart(4, "0") + String(amountCents).padStart(10, "0");
  const free = "0".repeat(25);
  const without = "0019" + tail + free;
  let sum = 0, weight = 2;
  for (let i = without.length - 1; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) sum += Number(without[i]) * weight;
  const raw = 11 - sum % 11, dv = [0, 10, 11].includes(raw) ? 1 : raw;
  function field(value: string) {
    let total = 0, multiplier = 2;
    for (let i = value.length - 1; i >= 0; i--, multiplier = multiplier === 2 ? 1 : 2) { const product = Number(value[i]) * multiplier; total += Math.floor(product / 10) + product % 10; }
    return value + String((10 - total % 10) % 10);
  }
  return field("0019" + free.slice(0, 5)) + field(free.slice(5, 15)) + field(free.slice(15)) + dv + tail;
}
