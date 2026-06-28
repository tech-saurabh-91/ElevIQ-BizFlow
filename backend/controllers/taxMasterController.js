const BaseController = require('./BaseController');
const { TaxMaster } = require('../models');

class TaxMasterController extends BaseController {
  constructor() {
    super(TaxMaster);
  }

  _getSearchableFields() {
    return ['taxName', 'taxCode', 'gstType'];
  }

  _getPopulateFields() {
    return [];
  }
}

module.exports = new TaxMasterController();
