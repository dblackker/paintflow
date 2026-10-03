import { compare, decimal, decimalText, divide, minor, moneyText, multiply } from './estimation-decimal';

export const SUPPLIER_EXTRACTION_VERSION = 'supplier-lines-v1';

function amount(value: unknown, name: string, signed = false, scale = 2): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Check the extracted ${name}.`);
  return Number(decimalText(decimal(value, name, { signed, scale }), scale));
}

function category(description: string): string {
  if (/\b(labor|hours|crew)\b/i.test(description)) return 'labor';
  if (/\b(ladder|sprayer|rental|equipment)\b/i.test(description)) return 'equipment';
  if (/\b(fee|paintcare|paint care|environmental|disposal|tax)\b/i.test(description)) return 'fees';
  if (/\b(caulk|tape|plastic|mask|roller|brush|tray|sandpaper|drop cloth)\b/i.test(description)) return 'supplies';
  return 'materials';
}

export function normalizeSupplierItems(input: unknown) {
  if (!Array.isArray(input)) throw new Error('The document did not contain an invoice line list.');
  if (input.length > 500) throw new Error('Split this document into smaller invoice files.');
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Check invoice line ${index + 1}.`);
    const item = raw as Record<string, unknown>;
    const productName = String(item.productName ?? item.product_name ?? item.product ?? item.name ?? '').trim();
    const description = String(item.description ?? item.item ?? productName).trim();
    if (!description || description.length > 2000) throw new Error(`Check the description on line ${index + 1}.`);
    const size = String(item.size ?? item.unitSize ?? item.unit_size ?? '').trim() || null;
    const rawGallons = item.gallons ?? item.gallonQuantity ?? item.gallon_quantity;
    const quantity = amount(item.quantity ?? item.qty ?? rawGallons ?? 1, 'quantity', true, 6);
    const gallonSize = /\b(gallon|gallons|gal)\b/i.test(size || '');
    const multiplier = gallonSize ? Number(size?.match(/(\d+(?:\.\d+)?)\s*(?:gal|gallon)/i)?.[1] || 1) : 0;
    const gallons = rawGallons != null ? amount(rawGallons, 'gallons', true, 6) : gallonSize ? quantity * multiplier : null;
    const rawCost = item.unitCost ?? item.unit_cost ?? item.unitPrice ?? item.unit_price ?? item.cost;
    const rawTotal = item.total ?? item.amount ?? item.value;
    if (rawCost == null && rawTotal == null) throw new Error(`Check the cost on line ${index + 1}.`);
    const providedCost = rawCost == null ? null : amount(rawCost, 'unit cost', false);
    const total = rawTotal != null ? amount(rawTotal, 'line total', true)
      : Number(moneyText(minor(multiply(decimal(quantity, 'quantity', { signed: true }), decimal(providedCost!, 'unit cost')), 'line total')));
    if (quantity === 0 && total !== 0) throw new Error(`Line ${index + 1} has an amount but no quantity.`);
    if (quantity < 0 && total > 0) throw new Error(`Check the return amount on line ${index + 1}.`);
    const unitCost = providedCost ?? (quantity === 0 ? 0 : Math.abs(total / quantity));
    const isFee = item.isFee === true || item.is_fee === true || item.category === 'fees'
      || /\b(fee|paint care|paintcare|environmental|disposal|tax)\b/i.test(description);
    const providedPerGallon = item.pricePerGallon ?? item.price_per_gallon ?? item.gallonPrice ?? item.gallon_price;
    if (!isFee && gallonSize && gallons != null && compare(decimal(gallons, 'gallons', { signed: true }),
      multiply(decimal(quantity, 'quantity', { signed: true }), decimal(multiplier, 'pack size'))) !== 0) {
      throw new Error(`Check the pack size and gallons on line ${index + 1}.`);
    }
    const pricePerGallon = !isFee && gallons
      ? Number(decimalText(divide(decimal(Math.abs(total), 'line total'), decimal(Math.abs(gallons), 'gallons')), 6)) : null;
    if (!isFee && providedPerGallon != null && (pricePerGallon == null ||
      minor(decimal(amount(providedPerGallon, 'price per gallon'), 'price per gallon'), 'price per gallon') !==
      minor(decimal(pricePerGallon, 'derived price per gallon'), 'derived price per gallon'))) {
      throw new Error(`Price per gallon does not match the purchased gallons and amount on line ${index + 1}.`);
    }
    return {
      description, productName: productName || null, size, quantity, unitCost, total,
      sku: String(item.sku ?? item.itemNumber ?? item.item_number ?? item.salesNumber ?? item.sales_number ?? '').trim() || null,
      salesNumber: String(item.salesNumber ?? item.sales_number ?? item.saleNumber ?? item.sale_number ?? '').trim() || null,
      productCode: String(item.productCode ?? item.product_code ?? '').trim() || null,
      colorName: String(item.colorName ?? item.color_name ?? item.color ?? '').trim() || null,
      colorCode: String(item.colorCode ?? item.color_code ?? '').trim() || null,
      sourceInvoiceNumber: String(item.sourceInvoiceNumber ?? item.source_invoice_number ?? item.invoiceNumber ?? item.invoice_number ?? '').trim() || null,
      poNumber: String(item.poNumber ?? item.po_number ?? item.po ?? '').trim() || null,
      purchaseDate: String(item.purchaseDate ?? item.purchase_date ?? item.invoiceDate ?? item.invoice_date ?? '').trim() || null,
      storeNumber: String(item.storeNumber ?? item.store_number ?? item.store ?? '').trim() || null,
      category: isFee ? 'fees' : ['labor', 'materials', 'supplies', 'equipment', 'subcontractors', 'other'].includes(String(item.category)) ? String(item.category) : category(description),
      gallons: isFee ? null : gallons, pricePerGallon: isFee ? null : pricePerGallon, isFee,
    };
  });
}

export function reconcileSupplierTotals(items: Array<{ total: number; sourceInvoiceNumber?: string | null }>,
  extracted: Record<string, unknown>, required = false) {
  const lineMinor = items.reduce((sum, item) => sum + minor(decimal(item.total, 'line total', { signed: true }), 'line total'), 0);
  const kind = String(extracted.documentType || 'invoice');
  let documentMinor: number | null = null;
  let groupedMismatch = false;
  if (kind === 'statement' || kind === 'invoice_bundle') {
    const charges = extracted.chargeTotals;
    if (Array.isArray(charges) && charges.length > 0 && charges.length <= 500) {
      const seen = new Set<string>();
      documentMinor = 0;
      for (const charge of charges) {
        if (!charge || typeof charge !== 'object') { documentMinor = null; break; }
        const id = String(charge.invoiceNumber || '').trim().toLowerCase();
        if (!id || seen.has(id) || charge.totalAmount == null) { documentMinor = null; break; }
        seen.add(id);
        const total = minor(decimal(charge.totalAmount, 'invoice charge total', { signed: true, scale: 2 }), 'invoice charge total');
        documentMinor += total;
        const matching = items.filter((item) => item.sourceInvoiceNumber?.trim().toLowerCase() === id);
        if (!matching.length || matching.reduce((sum, item) => sum + minor(decimal(item.total, 'line total', { signed: true }), 'line total'), 0) !== total) groupedMismatch = true;
      }
      if (items.some((item) => !seen.has(item.sourceInvoiceNumber?.trim().toLowerCase() || ''))) groupedMismatch = true;
    }
  } else {
    const value = extracted.totalAmount ?? extracted.total_amount;
    if (value != null) documentMinor = minor(decimal(value as string | number, 'document charge total', { signed: true, scale: 2 }), 'document charge total');
  }
  return {
    required, kind, lineTotal: moneyText(lineMinor),
    documentTotal: documentMinor == null ? null : moneyText(documentMinor),
    status: documentMinor == null ? 'unavailable' : groupedMismatch || documentMinor !== lineMinor ? 'mismatch' : 'matched',
  };
}
