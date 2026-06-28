const BaseController = require('./BaseController');
const { Warehouse } = require('../models');

class WarehouseController extends BaseController {
  constructor() {
    super(Warehouse);
  }

  _getSearchableFields() {
    return ['warehouseName', 'warehouseCode', 'city'];
  }

  _getPopulateFields() {
    return ['parentWarehouseId'];
  }
}

module.exports = new WarehouseController();
