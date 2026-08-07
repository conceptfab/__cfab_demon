import type { ProjectCost } from '@/lib/tauri/costs';

/**
 * Parsuje kwotę z pola tekstowego. Akceptuje przecinek jako separator dziesiętny
 * (polska klawiatura numeryczna). Zwraca `null` dla wartości nienumerycznych
 * i ujemnych — koszt 0 jest legalny (np. pozycja informacyjna).
 */
export function parseAmountInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function sumCosts(costs: ProjectCost[]): number {
  return costs.reduce((acc, c) => acc + c.amount, 0);
}
