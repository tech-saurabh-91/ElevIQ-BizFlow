import dayjs from 'dayjs';
import { runWithContext } from '../middlewares/tenantContext.js';
import logger from '../utils/logger.js';

import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import Supplier from '../models/Supplier.js';
import Setting from '../models/Setting.js';
import StockBalance from '../models/StockBalance.js';
import StockMovement from '../models/StockMovement.js';
import StockAdjustment from '../models/StockAdjustment.js';
import StockTransfer from '../models/StockTransfer.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodsReceipt.js';

import {
  MOVEMENT_TYPES,
  ADJUSTMENT_STATUS,
  TRANSFER_STATUS,
  GRN_STATUS,
  PURCHASE_ORDER_STATUS,
} from '../config/constants.js';
import {
  recordMovement,
  resolveDefaultWarehouse,
  nextAdjustmentNumber,
  nextTransferNumber,
  nextPurchaseOrderNumber,
  nextGrnNumber,
} from '../services/inventoryService.js';
import { rollForwardPo } from '../controllers/company/purchaseController.js';

/**
 * Phase 7 demo inventory.
 *
 * Everything goes through `inventoryService.recordMovement` - the single stock
 * write path - so `StockBalance`, `StockMovement` and the company-wide
 * `Product.stock` snapshot stay consistent with what the UI and the reports
 * read. Seeds, in order:
 *
 *   1. opening balances for every product (type OPENING),
 *   2. a posted cycle-count adjustment,
 *   3. a dispatched + received transfer (when a second warehouse exists),
 *   4. a SENT purchase order with a partially posted GRN.
 *
 * Safe to re-run: skipped entirely once any StockBalance row exists.
 */

const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const historyFor = (status, at, by, name, note) => [
  { status, at, by: by || null, byName: name || 'System', note },
];

const run = async (company, users = []) =>
  runWithContext({ scope: 'company', companyId: String(company._id), userId: null }, async () => {
    const existing = await StockBalance.countDocuments({});
    if (existing > 0) {
      logger.info(`Inventory already seeded (${existing} balance lines found).`);
      return;
    }

    const [settings, products, warehouses, suppliers] = await Promise.all([
      Setting.forCompany(company._id),
      Product.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean(),
      Warehouse.find({ isActive: { $ne: false } }).sort({ createdAt: 1 }).lean(),
      Supplier.find({ isActive: { $ne: false } }).sort({ createdAt: 1 }).lean(),
    ]);

    if (!products.length) {
      logger.warn('Skipping inventory seed: no products found.');
      return;
    }

    const actor = users.find((u) => u.role === 'COMPANY_ADMIN') || users[0] || null;
    const actorName = actor?.name || 'System';
    const main = (await resolveDefaultWarehouse(settings)) || warehouses[0] || null;
    const warehouseId = main?._id || null;

    // ---- 1) Opening balances ------------------------------------------------
    // Zero the snapshot first so `recordMovement`'s legacy-stock migration
    // cannot double count: after the call both balance and Product.stock equal
    // the intended opening quantity.
    let opening = 0;
    for (const p of products) {
      const qty = Number(p.stock || 0);
      if (qty <= 0) continue;
      await Product.updateOne({ _id: p._id }, { $set: { stock: 0 } }).skipTenant();
      await recordMovement({
        product: p._id,
        warehouse: warehouseId,
        qty,
        type: MOVEMENT_TYPES.OPENING,
        reason: 'Opening stock',
        note: 'Seeded opening balance',
        unitCost: Number(p.purchasePrice || 0),
        movedBy: actor?._id || null,
        settings,
      });
      opening += 1;
    }
    logger.info(`Seeded opening stock for ${opening} products.`);

    // ---- 2) Posted cycle-count adjustment ----------------------------------
    const countTarget = products.find((p) => Number(p.stock || 0) > 0);
    if (countTarget && main) {
      const adj = new StockAdjustment({
        adjustmentDate: dayjs().subtract(3, 'day').hour(10).minute(30).toDate(),
        warehouse: main._id,
        warehouseCode: main.code || '',
        warehouseName: main.name || '',
        reason: 'COUNT',
        items: [
          {
            product: countTarget._id,
            name: countTarget.name || '',
            sku: countTarget.sku || '',
            unit: countTarget.unit || 'PCS',
            qty: 2,
            unitCost: Number(countTarget.purchasePrice || 0),
            note: 'Cycle count variance found on shelf',
          },
        ],
        status: ADJUSTMENT_STATUS.DRAFT,
        statusHistory: historyFor(
          ADJUSTMENT_STATUS.DRAFT,
          dayjs().subtract(3, 'day').toDate(),
          actor?._id,
          actorName,
          'Adjustment created'
        ),
        notes: 'Monthly cycle count at the main warehouse.',
      });
      adj.adjustmentNo = await nextAdjustmentNumber(company._id, settings, adj.adjustmentDate);
      await adj.save();

      for (const line of adj.items) {
        await recordMovement({
          product: line.product,
          warehouse: adj.warehouse,
          qty: line.qty,
          type: MOVEMENT_TYPES.ADJUSTMENT,
          refType: 'ADJUSTMENT',
          refId: adj._id,
          refNo: adj.adjustmentNo,
          reason: 'Stock count',
          note: 'Cycle count variance',
          unitCost: Number(line.unitCost || 0),
          movedBy: actor?._id || null,
          settings,
        });
      }

      adj.status = ADJUSTMENT_STATUS.POSTED;
      adj.postedAt = new Date();
      adj.postedBy = actor?._id || null;
      adj.statusHistory.push({
        status: ADJUSTMENT_STATUS.POSTED,
        at: new Date(),
        by: actor?._id || null,
        byName: actorName,
        note: 'Adjustment posted',
      });
      await adj.save();
      logger.info(`Seeded adjustment ${adj.adjustmentNo}.`);
    }

    // ---- 3) Transfer main -> branch (dispatched and received) ---------------
    const branch = warehouses.find((w) => String(w._id) !== String(main?._id));
    const moveTarget = products.find((p) => Number(p.stock || 0) >= 30);
    if (main && branch && moveTarget) {
      const qty = 10;
      const transfer = new StockTransfer({
        transferDate: dayjs().subtract(2, 'day').hour(9).minute(0).toDate(),
        fromWarehouse: main._id,
        fromWarehouseCode: main.code || '',
        fromWarehouseName: main.name || '',
        toWarehouse: branch._id,
        toWarehouseCode: branch.code || '',
        toWarehouseName: branch.name || '',
        items: [
          {
            product: moveTarget._id,
            name: moveTarget.name || '',
            sku: moveTarget.sku || '',
            unit: moveTarget.unit || 'PCS',
            qty,
          },
        ],
        status: TRANSFER_STATUS.DRAFT,
        statusHistory: historyFor(
          TRANSFER_STATUS.DRAFT,
          dayjs().subtract(2, 'day').toDate(),
          actor?._id,
          actorName,
          'Transfer created'
        ),
        notes: 'Replenish the branch store ahead of the weekend.',
      });
      transfer.transferNo = await nextTransferNumber(company._id, settings, transfer.transferDate);
      await transfer.save();

      for (const line of transfer.items) {
        line.dispatchedQty = line.qty;
        await recordMovement({
          product: line.product,
          warehouse: transfer.fromWarehouse,
          qty: -line.qty,
          type: MOVEMENT_TYPES.TRANSFER_OUT,
          refType: 'TRANSFER',
          refId: transfer._id,
          refNo: transfer.transferNo,
          reason: 'Transfer dispatched',
          unitCost: Number(moveTarget.purchasePrice || 0),
          movedBy: actor?._id || null,
          settings,
        });
      }
      transfer.status = TRANSFER_STATUS.DISPATCHED;
      transfer.dispatchedAt = new Date();
      transfer.dispatchedBy = actor?._id || null;
      transfer.statusHistory.push({
        status: TRANSFER_STATUS.DISPATCHED,
        at: new Date(),
        by: actor?._id || null,
        byName: actorName,
        note: 'Loaded on vehicle',
      });
      await transfer.save();

      for (const line of transfer.items) {
        line.receivedQty = line.dispatchedQty;
        await recordMovement({
          product: line.product,
          warehouse: transfer.toWarehouse,
          qty: line.receivedQty,
          type: MOVEMENT_TYPES.TRANSFER_IN,
          refType: 'TRANSFER',
          refId: transfer._id,
          refNo: transfer.transferNo,
          reason: 'Transfer received',
          unitCost: Number(moveTarget.purchasePrice || 0),
          movedBy: actor?._id || null,
          settings,
        });
      }
      transfer.status = TRANSFER_STATUS.RECEIVED;
      transfer.receivedAt = new Date();
      transfer.receivedBy = actor?._id || null;
      transfer.statusHistory.push({
        status: TRANSFER_STATUS.RECEIVED,
        at: new Date(),
        by: actor?._id || null,
        byName: actorName,
        note: 'Received in full',
      });
      await transfer.save();
      logger.info(`Seeded transfer ${transfer.transferNo}.`);
    }

    // ---- 4) Purchase order + partially posted GRN ---------------------------
    const supplier = suppliers[0];
    if (supplier && main) {
      const buyLines = products.slice(0, 2).map((p) => {
        const qty = 24;
        const unitPrice = Number(p.purchasePrice || 0);
        const taxRate = Number(p.gstRate || 0);
        const taxableAmount = r2(qty * unitPrice);
        const taxAmount = r2((taxableAmount * taxRate) / 100);
        return {
          product: p._id,
          name: p.name || '',
          sku: p.sku || '',
          unit: p.unit || 'PCS',
          hsnCode: p.hsnCode || '',
          qty,
          receivedQty: 0,
          unitPrice,
          discountPercent: 0,
          discountAmount: 0,
          taxRate,
          taxableAmount,
          taxAmount,
          lineTotal: r2(taxableAmount + taxAmount),
        };
      });

      const subtotal = r2(buyLines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
      const taxableTotal = r2(buyLines.reduce((s, l) => s + l.taxableAmount, 0));
      const taxTotal = r2(buyLines.reduce((s, l) => s + l.taxAmount, 0));
      const gross = taxableTotal + taxTotal;
      const total = r2(gross);

      const po = new PurchaseOrder({
        poDate: dayjs().subtract(5, 'day').hour(11).minute(0).toDate(),
        expectedDate: dayjs().add(4, 'day').toDate(),
        supplierId: supplier._id,
        supplierName: supplier.name || '',
        supplierCode: supplier.code || '',
        supplierGstin: supplier.gstin || '',
        warehouse: main._id,
        items: buyLines,
        subtotal,
        discountTotal: 0,
        taxableTotal,
        taxTotal,
        roundOff: r2(total - gross),
        total,
        status: PURCHASE_ORDER_STATUS.DRAFT,
        statusHistory: historyFor(
          PURCHASE_ORDER_STATUS.DRAFT,
          dayjs().subtract(5, 'day').toDate(),
          actor?._id,
          actorName,
          'Purchase order created'
        ),
        notes: 'Monthly replenishment for the main warehouse.',
      });
      po.poNo = await nextPurchaseOrderNumber(company._id, settings, po.poDate);
      await po.save();

      po.status = PURCHASE_ORDER_STATUS.SENT;
      po.sentAt = new Date();
      po.statusHistory.push({
        status: PURCHASE_ORDER_STATUS.SENT,
        at: new Date(),
        by: actor?._id || null,
        byName: actorName,
        note: 'Order placed with the supplier',
      });
      await po.save();

      // Receive ~60% of every line so the PO shows PARTIALLY_RECEIVED progress.
      const grn = new GoodsReceipt({
        grnDate: dayjs().subtract(1, 'day').hour(15).minute(45).toDate(),
        purchaseOrder: po._id,
        poNo: po.poNo,
        supplierId: supplier._id,
        supplierName: supplier.name || '',
        warehouse: main._id,
        warehouseCode: main.code || '',
        warehouseName: main.name || '',
        items: po.items.map((l) => ({
          product: l.product,
          name: l.name,
          sku: l.sku,
          unit: l.unit,
          orderedQty: l.qty,
          receivedQty: Math.max(1, Math.floor(l.qty * 0.6)),
          unitCost: l.unitPrice,
        })),
        invoiceNo: `BILL-${dayjs().format('YYMM')}101`,
        vehicleNo: 'MH-12-AB-4471',
        status: GRN_STATUS.DRAFT,
        statusHistory: historyFor(
          GRN_STATUS.DRAFT,
          dayjs().subtract(1, 'day').toDate(),
          actor?._id,
          actorName,
          'Goods receipt created'
        ),
        notes: 'Short receipt: balance of the order arrives next week.',
      });
      grn.grnNo = await nextGrnNumber(company._id, settings, grn.grnDate);
      await grn.save();

      for (const line of grn.items) {
        const accepted = Number(line.acceptedQty || 0);
        if (accepted <= 0) continue;
        await recordMovement({
          product: line.product,
          warehouse: grn.warehouse,
          qty: accepted,
          type: MOVEMENT_TYPES.PURCHASE_RECEIPT,
          refType: 'GOODS_RECEIPT',
          refId: grn._id,
          refNo: grn.grnNo,
          reason: 'Goods received',
          note: 'Supplier delivery booked into stock',
          unitCost: Number(line.unitCost || 0),
          movedBy: actor?._id || null,
          settings,
        });
      }

      grn.status = GRN_STATUS.POSTED;
      grn.postedAt = new Date();
      grn.postedBy = actor?._id || null;
      grn.statusHistory.push({
        status: GRN_STATUS.POSTED,
        at: new Date(),
        by: actor?._id || null,
        byName: actorName,
        note: 'Receipt posted to stock',
      });
      await grn.save();

      await rollForwardPo(po._id);
      logger.info(`Seeded purchase order ${po.poNo} and receipt ${grn.grnNo}.`);
    }

    const [balances, movements] = await Promise.all([
      StockBalance.countDocuments({}),
      StockMovement.countDocuments({}),
    ]);
    logger.info(`Seeded inventory: ${balances} balance lines, ${movements} ledger movements.`);
  });

export default run;
