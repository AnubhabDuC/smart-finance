export function resolveIssuer(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return "";

  const rules: Array<{ canonical: string; aliases: string[] }> = [
    { canonical: "American Express Banking", aliases: ["amex", "american express", "americanexpress"] },
    { canonical: "ICICI Bank", aliases: ["icici", "icic"] },
    { canonical: "HDFC Bank", aliases: ["hdfc"] },
    { canonical: "SBI", aliases: ["sbi", "state bank"] },
    { canonical: "Axis Bank", aliases: ["axis"] },
    { canonical: "Kotak", aliases: ["kotak"] },
  ];

  for (const rule of rules) {
    if (rule.aliases.some((alias) => value.includes(alias))) {
      return rule.canonical;
    }
  }
  return input.trim();
}
