// Ced's KRO5 team. They work from the KRO5 Project docs through the KRO5 Voice Request routine (ask_team);
// the app shows them as teammates Ced can tap to ask.
export type Teammate = { handle: string; name: string; does: string };

export const team: Teammate[] = [
  { handle: "Chief of Staff", name: "Chief of Staff", does: "Daily brief, priorities, follow-ups" },
  { handle: "CFO", name: "CFO", does: "Pricing, cash, costs, forecasts" },
  { handle: "CMO", name: "CMO", does: "Outreach, content, positioning" },
  { handle: "COO", name: "COO", does: "Operations, processes, delivery" },
  { handle: "CTO", name: "CTO / CPO", does: "Product, tech plans, build briefs" },
  { handle: "General Counsel", name: "General Counsel", does: "Contracts, privacy, compliance" },
  { handle: "VA Lead", name: "VA Lead", does: "KRO5 for VA Agencies product and agencies" },
  { handle: "Courts Lead", name: "Courts Lead", does: "KRO5 Courts" },
  { handle: "Chair", name: "Chair", does: "Board view and big decisions" },
  { handle: "Independent Director", name: "Independent Director", does: "Outside challenge on plans" },
];
