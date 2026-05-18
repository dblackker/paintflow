import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { materialPurchases, jobCosts, materials } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const invoicesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
invoicesApp.use('*', authMiddleware);

// Parse CSV invoice
function parseCSV(csvText: string) {
  const lines = csvText.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const item: any = {};
    headers.forEach((h, idx) => {
      item[h] = values[idx];
    });
    
    // Try to match common column names
    const description = item.description || item.item || item['item description'] || item.product;
    const sku = item.sku || item['item number'] || item['product code'];
    const quantity = parseFloat(item.quantity || item.qty || '0');
    const unitCost = parseFloat(item['unit cost'] || item.cost || item['unit price'] || '0');
    const total = parseFloat(item.total || item.amount || (quantity * unitCost).toString());
    
    if (description && quantity > 0 && unitCost > 0) {
      items.push({ description, sku, quantity, unitCost, total });
    }
  }
  
  return items;
}

invoicesApp.post('/upload', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const { csvData, supplier, invoiceNumber, jobId } = body;
  const db = createDb(c.env.DATABASE_URL);
  
  if (!csvData || !supplier) {
    return c.json({ error: 'CSV data and supplier required' }, 400);
  }
  
  const items = parseCSV(csvData);
  if (items.length === 0) {
    return c.json({ error: 'No valid items found in CSV' }, 400);
  }
  
  const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
  
  // Create purchase record
  const [purchase] = await db.insert(materialPurchases).values({
    orgId,
    jobId: jobId || null,
    supplier,
    invoiceNumber: invoiceNumber || null,
    totalAmount: totalAmount.toString(),
    parsedData: items,
  }).returning();
  
  // Update material costs and create job costs
  for (const item of items) {
    // Try to match to existing material by SKU or name
    const material = await db.query.materials.findFirst({
      where: and(
        eq(materials.orgId, orgId),
        eq(materials.sku, item.sku || '')
      ),
    });
    
    if (material) {
      // Update material cost if different
      const currentCost = parseFloat(material.costPerUnit);
      if (Math.abs(currentCost - item.unitCost) > 0.01) {
        await db.update(materials)
          .set({ costPerUnit: item.unitCost.toString(), updatedAt: new Date() })
          .where(eq(materials.id, material.id));
      }
    }
    
    // Create job cost if jobId provided
    if (jobId) {
      await db.insert(jobCosts).values({
        jobId,
        orgId,
        category: 'materials',
        description: item.description,
        quantity: item.quantity.toString(),
        unitCost: item.unitCost.toString(),
        totalCost: item.total.toString(),
        materialPurchaseId: purchase.id,
      });
    }
  }
  
  return c.json({ 
    data: {
      purchaseId: purchase.id,
      itemsProcessed: items.length,
      totalAmount,
      items
    }
  }, 201);
});

invoicesApp.get('/purchases', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const purchases = await db.query.materialPurchases.findMany({
    where: eq(materialPurchases.orgId, orgId),
    orderBy: (purchases, { desc }) => [desc(purchases.createdAt)],
    limit: 50,
  });
  
  return c.json({ data: purchases });
});

export default invoicesApp;
