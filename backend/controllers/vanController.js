const BaseController = require('./BaseController');
const { VAN } = require('../models');

class VanController extends BaseController {
  constructor() {
    super(VAN);
  }

  _getSearchableFields() {
    return ['vanName', 'vanCode', 'vehicleNumber'];
  }

  _getPopulateFields() {
    return ['warehouseId', 'customerId'];
  }
}

module.exports = new VanController();
