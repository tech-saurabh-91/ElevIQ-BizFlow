const { Company } = require('../models');

class TaxCalculator {
  /**
   * Calculate tax for an item based on company's taxInclusive setting
   * @param {Object} company - Company document
   * @param {Number} price - Unit price (could be inclusive or exclusive)
   * @param {Number} taxPercent - Tax percentage
   * @param {Number} quantity - Quantity
   * @returns {Object} Tax breakdown
   */
  static calculateItemTax(company, price, taxPercent, quantity = 1) {
    const totalBasePrice = price * quantity;

    if (company.taxInclusive) {
      // Price already includes tax
      // basePrice = price / (1 + taxPercent/100)
      const basePricePerUnit = taxPercent > 0 ? price / (1 + taxPercent / 100) : price;
      const taxAmountPerUnit = price - basePricePerUnit;

      return {
        unitPrice: price,
        basePricePerUnit: Math.round(basePricePerUnit * 100) / 100,
        taxAmountPerUnit: Math.round(taxAmountPerUnit * 100) / 100,
        basePrice: Math.round(basePricePerUnit * quantity * 100) / 100,
        taxAmount: Math.round(taxAmountPerUnit * quantity * 100) / 100,
        totalAmount: price * quantity,
        taxPercent: taxPercent,
        isInclusive: true,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
      };
    } else {
      // Tax is added on top of price
      const taxAmount = totalBasePrice * (taxPercent / 100);

      return {
        unitPrice: price,
        basePricePerUnit: price,
        taxAmountPerUnit: price * (taxPercent / 100),
        basePrice: totalBasePrice,
        taxAmount: Math.round(taxAmount * 100) / 100,
        totalAmount: Math.round((totalBasePrice + taxAmount) * 100) / 100,
        taxPercent: taxPercent,
        isInclusive: false,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
      };
    }
  }

  /**
   * Calculate GST breakdown (CGST + SGST or IGST based on state)
   * @param {Object} company - Company document
   * @param {Object} itemTax - Tax calculation result
   * @param {String} customerState - Customer's state
   * @returns {Object} GST breakdown
   */
  static calculateGSTBreakdown(company, itemTax, customerState) {
    const isInterState = company.stateCode && customerState &&
      company.stateCode !== customerState;

    const result = { ...itemTax };

    if (isInterState) {
      // Inter-state: IGST
      result.igstAmount = itemTax.taxAmount;
      result.cgstAmount = 0;
      result.sgstAmount = 0;
      result.gstType = 'IGST';
    } else {
      // Intra-state: CGST + SGST (50% each)
      result.cgstAmount = Math.round((itemTax.taxAmount / 2) * 100) / 100;
      result.sgstAmount = Math.round((itemTax.taxAmount / 2) * 100) / 100;
      result.igstAmount = 0;
      result.gstType = 'CGST+SGST';
    }

    return result;
  }

  /**
   * Calculate total order tax
   * @param {Object} company - Company document
   * @param {Array} items - Order items with price, quantity, taxPercent
   * @param {String} customerState - Customer's state
   * @returns {Object} Order tax summary
   */
  static calculateOrderTax(company, items, customerState) {
    let totalBasePrice = 0;
    let totalTaxAmount = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let grandTotal = 0;

    const calculatedItems = items.map(item => {
      const itemTax = this.calculateItemTax(company, item.unitPrice, item.taxPercent, item.quantity);
      const gstBreakdown = this.calculateGSTBreakdown(company, itemTax, customerState);

      totalBasePrice += gstBreakdown.basePrice;
      totalTaxAmount += gstBreakdown.taxAmount;
      totalCgst += gstBreakdown.cgstAmount;
      totalSgst += gstBreakdown.sgstAmount;
      totalIgst += gstBreakdown.igstAmount;
      grandTotal += gstBreakdown.totalAmount;

      return {
        ...item,
        basePrice: gstBreakdown.basePrice,
        taxAmount: gstBreakdown.taxAmount,
        totalAmount: gstBreakdown.totalAmount,
        cgstAmount: gstBreakdown.cgstAmount,
        sgstAmount: gstBreakdown.sgstAmount,
        igstAmount: gstBreakdown.igstAmount,
        gstType: gstBreakdown.gstType,
      };
    });

    return {
      items: calculatedItems,
      totalBasePrice: Math.round(totalBasePrice * 100) / 100,
      totalTaxAmount: Math.round(totalTaxAmount * 100) / 100,
      totalCgst: Math.round(totalCgst * 100) / 100,
      totalSgst: Math.round(totalSgst * 100) / 100,
      totalIgst: Math.round(totalIgst * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      taxInclusive: company.taxInclusive,
    };
  }
}

module.exports = TaxCalculator;
