const BaseController = require('./BaseController');
const { HsnMaster } = require('../models');

class HsnMasterController extends BaseController {
  constructor() {
    super(HsnMaster);
  }

  _getSearchableFields() {
    return ['hsnCode', 'hsnDescription'];
  }

  _getPopulateFields() {
    return ['cgstTaxId', 'sgstTaxId', 'igstTaxId', 'cessTaxId'];
  }
}

module.exports = new HsnMasterController();
