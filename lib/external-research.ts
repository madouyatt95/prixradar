function compactQuery(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 180);
}

export function externalResearchLinks(product: {
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
}) {
  const identity = compactQuery(
    product.gtin || [product.brand, product.model, product.title].filter(Boolean).join(" "),
  );
  const encoded = encodeURIComponent(identity);
  return {
    query: identity,
    idealo: `https://www.idealo.fr/preisvergleich/MainSearchProductCategory.html?q=${encoded}`,
    dealabs: `https://www.dealabs.com/search?q=${encoded}`,
    policy: {
      idealo: "comparison_reference",
      dealabs: "community_context",
      automaticIngestion: false,
    },
  } as const;
}
