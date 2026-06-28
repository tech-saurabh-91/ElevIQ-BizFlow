const BaseController = require('./BaseController');
const { ItemSubGroup } = require('../models');

class ItemSubGroupController extends BaseController {
  constructor() {
    super(ItemSubGroup);
  }

  _getSearchableFields() {
    return ['subGroupName', 'subGroupCode', 'description'];
  }

  _getPopulateFields() {
    return ['groupId'];
  }

  _getCompanyId(req) {
    return req.companyId;
  }

  _getCreatedByField() {
    return 'createdBy';
  }
}

module.exports = new ItemSubGroupController();
