const BaseController = require('./BaseController');
const { ItemGroup } = require('../models');

class ItemGroupController extends BaseController {
  constructor() {
    super(ItemGroup);
  }

  _getSearchableFields() {
    return ['groupName', 'groupCode', 'description'];
  }

  _getCompanyId(req) {
    return req.companyId;
  }

  _getCreatedByField() {
    return 'createdBy';
  }
}

module.exports = new ItemGroupController();
