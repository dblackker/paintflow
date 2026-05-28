type EstimateLineItem = {
  customerVisible?: boolean;
  optional?: boolean;
  desc?: string;
  roomName?: string;
  surfaceName?: string;
  material?: {
    name?: string;
    brand?: string;
    colorName?: string;
    colorCode?: string;
  };
};

function packageItems(pkg: unknown) {
  const value = pkg as { items?: unknown[]; lineItems?: unknown[] } | undefined;
  return Array.isArray(value?.items) ? value.items : Array.isArray(value?.lineItems) ? value.lineItems : [];
}

function selectedPackage(packages: unknown) {
  const values = Array.isArray(packages) ? packages as Array<{ name?: string; items?: unknown[]; lineItems?: unknown[] }> : [];
  return values.find((pkg) => pkg.name === 'proposal')
    ?? values.find((pkg) => /better|recommended/i.test(String(pkg.name || '')))
    ?? values[0];
}

function itemLabel(item: EstimateLineItem) {
  const room = item.roomName || String(item.desc || '').split(':')[0] || 'Project';
  const surface = item.surfaceName || String(item.desc || '').replace(/^[^:]+:\s*/, '') || 'Substrate';
  return [room, surface].filter(Boolean).join(' - ');
}

export function estimateColorReadiness(packages: unknown) {
  const pkg = selectedPackage(packages);
  const items = packageItems(pkg)
    .map((item) => item as EstimateLineItem)
    .filter((item) => item.customerVisible !== false && !item.optional && Boolean(item.material?.name));

  const missingItems = items
    .filter((item) => !String(item.material?.colorName || '').trim())
    .map((item) => ({
      label: itemLabel(item),
      product: [item.material?.brand, item.material?.name].filter(Boolean).join(' ') || item.material?.name || 'Paint product',
    }));

  return {
    required: items.length,
    selected: items.length - missingItems.length,
    missing: missingItems.length,
    complete: items.length === 0 || missingItems.length === 0,
    missingItems: missingItems.slice(0, 8),
  };
}
