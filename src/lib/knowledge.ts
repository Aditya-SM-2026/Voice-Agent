import ajai from "../../data/ajai.json";

// The small, static knowledge base for the (fictional) company AJAI.
// No vector search: the dataset is tiny, so we inline it into the system prompt.
export const ajaiKnowledge = ajai;

export function formatKnowledge(): string {
  const k = ajaiKnowledge;
  return [
    `Company: ${k.company}`,
    `Description: ${k.description}`,
    `Tagline: ${k.tagline}`,
    `Use cases: ${k.useCases.join(", ")}`,
    `Pricing: ${k.pricing.map((p) => `${p.plan} costs ${p.price}`).join("; ")}`,
    `Integrations: ${k.integrations.join(", ")}`,
    `Free trial: ${k.freeTrial}`,
    `CEO: ${k.leadership.ceo}`,
    `CTO: ${k.leadership.cto}`,
    `Headquarters: ${k.headquarters}`,
    `Employees: ${k.employees}`,
    `Customers: ${k.customers}`,
    `Support: ${k.support}`,
  ].join("\n");
}