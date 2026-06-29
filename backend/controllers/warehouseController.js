const BaseController = require('./BaseController');
const { Warehouse } = require('../models');

class WarehouseController extends BaseController {
  constructor() {
    super(Warehouse);
  }

  _getSearchableFields() {
    return ['warehouseName', 'warehouseCode', 'city', 'natureOfWarehouse'];
  }

  _getPopulateFields() {
    return ['parentWarehouseId', 'vanParentWarehouseId'];
  }
}

module.exports = new WarehouseController();
