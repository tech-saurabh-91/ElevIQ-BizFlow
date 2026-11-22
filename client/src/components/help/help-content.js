/**
 * Help content: step-by-step guides and short FAQs, in plain words.
 *
 * Text only, on purpose: nothing here opens a screen or links anywhere, so a
 * salesman asking a question never lands on a page their role cannot use.
 * Screens are named the way the left menu names them.
 *
 * `roles` limits an entry to those company roles; no `roles` = everyone.
 * A guide body is a list of blocks: { p }, { h }, { steps: [] }, { list: [] }.
 */

const ADMIN = ['COMPANY_ADMIN'];
const OFFICE = ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT'];
const FIELD = ['SALESMAN', 'MANAGER'];
const STOCK = ['COMPANY_ADMIN', 'MANAGER', 'WAREHOUSE'];

export const GUIDES = [
  {
    id: 'start',
    title: 'Getting started and finding your way',
    body: [
      { p: 'ElevIQ Bizflow runs your distribution business: sales orders, invoices, collections, returns, stock, purchases, the field team and reports. Everyone signs in with their own email or phone and sees only the screens their role allows.' },
      { h: 'Moving around' },
      { p: 'The menu on the left lists the screens you can use. On a phone, tap the menu button at the top left, or use the bar at the bottom. If something you need is missing from your menu, your role does not include it: ask your admin or manager.' },
      { h: 'The bell' },
      { p: 'The bell at the top right shows notifications: approvals waiting, requests answered, announcements. Open the Notifications screen to read them all.' },
      { h: 'Your profile and password' },
      { p: 'Tap your name or picture at the top right for My profile and Change password. A new account must change its first password before it can save anything.' },
      { h: 'Light and dark' },
      { p: 'The sun / moon button at the top switches between light and dark screens.' },
    ],
  },
  {
    id: 'setup',
    title: 'First setup for a new company',
    roles: ADMIN,
    body: [
      { p: 'Do these once, in this order. Each step uses what the step before created.' },
      {
        steps: [
          'Company Settings: business details, address, tax registration, currency, financial year, tax settings and invoice options. Check currency, country, financial year and tax regime carefully: they lock after the first transaction.',
          'Categories & Units: product categories, brands and units (PCS, BOX...).',
          'Warehouses: your main godown. Add a Damaged warehouse if you take back damaged goods, and van warehouses if salesmen sell from a van.',
          'Products: name, unit, tax rate, MRP, selling price and purchase price. Opening stock can be entered when you create the product.',
          'Price Lists (optional): special prices for groups of customers, e.g. dealers or wholesalers.',
          'Routes & Beats: the areas your salesmen cover, then Customers on those routes.',
          'Suppliers (if you use Purchase).',
          'Users & Teams: add your staff with the right role, then plan their days in Beat Plan.',
        ],
      },
    ],
  },
  {
    id: 'visit',
    title: 'A day in the field: attendance and shop visits',
    roles: FIELD,
    body: [
      { h: 'Start the day' },
      { steps: ['Open Attendance and check in. Your phone location is saved with it, so allow location access.', 'At the end of the day, check out from the same screen.'] },
      { h: 'Visit a shop' },
      {
        steps: [
          'Open Sales Visit and pick today\'s route. Your beat plan decides which route shows first.',
          'Tap Directions on a shop to open Google Maps with the way there. Nearest first puts the closest shops on top and each card shows how far the shop is.',
          'Choose the shop and check in. You must be near the shop if your company uses the shop location check.',
          'Book the order (or the invoice if you sell from a van), take a payment if the shop pays, or note why there was no order.',
          'Check out of the shop. You cannot check in to another shop until you do.',
        ],
      },
      { p: 'Visit and attendance times are always today and now: they cannot be back-dated or set in the future.' },
      { p: 'Directions use the shop location saved on the customer. When no location is saved they use the shop address, which is less exact: ask your office to pin the shop location.' },
    ],
  },
  {
    id: 'visit-register',
    title: 'Visit Register: what the field team did',
    roles: ['COMPANY_ADMIN', 'MANAGER'],
    body: [
      { list: [
        'Open Reports > Register Reports > Visit Register. It lists every visit: check-in and check-out time, minutes at the shop, how far from the shop the rep checked in (with a map link), outcome, no-order reason and what was booked or collected.',
        'The cards on top show shops visited, productive visits (an order or invoice) with the percentage, average minutes at a shop, and check-ins away from the shop.',
        'The Show filter picks productive visits, visits with no order, visits not checked out, check-ins away from the shop, and planned shops that were not visited.',
        'Export it to Excel or print it like any other report.',
      ] },
    ],
  },
  {
    id: 'orders',
    title: 'Orders and invoices',
    body: [
      { h: 'Book an order' },
      {
        steps: [
          'Open Orders (My Orders for salesmen) and tap New order, or book it from Sales Visit.',
          'Choose the customer. Their price list, discounts and schemes apply on their own.',
          'Add products and quantities. Prices come from the customer\'s price list, else the product\'s selling price. Free goods from schemes are added as zero-price lines.',
          'Save as draft, or submit it. A manager may need to approve it, depending on your company\'s settings.',
        ],
      },
      { h: 'Make the invoice' },
      {
        steps: [
          'Open the approved order and choose to create the invoice, or start a new invoice from Invoices.',
          'Check the lines and issue the invoice. Issuing the invoice takes the goods out of stock; there is no separate dispatch step.',
          'Print or share the invoice from its detail screen.',
        ],
      },
      { p: 'A price cannot go above the product\'s MRP, and the tax rate comes from the product.' },
      { h: 'Limits on discounts and approvals' },
      { list: [
        'Your admin may set the most discount you can type by hand. A price typed below the price list counts as a discount too. Above your limit the line is refused; ask someone with a higher limit.',
        'Approvers may have an amount limit: an order above it must be approved by someone with a higher limit.',
        'If your company uses maker-checker, someone else must approve the orders you booked.',
      ] },
    ],
  },
  {
    id: 'payments',
    title: 'Collections and payments',
    roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'SALESMAN'],
    body: [
      {
        steps: [
          'Open Payments & Collections (My Collections for salesmen) and tap New payment.',
          'Choose the customer, the amount and the mode: cash, cheque, UPI, bank transfer...',
          'Set it against that customer\'s open invoices. Anything left over stays as an advance on the customer.',
          'Save. The customer\'s outstanding goes down straight away.',
        ],
      },
      { p: 'A receipt can only settle invoices of the customer who paid.' },
    ],
  },
  {
    id: 'returns',
    title: 'Returns and credit notes',
    roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'SALESMAN'],
    body: [
      {
        steps: [
          'Open Credit Notes (My Returns for salesmen) and create a new one for the customer.',
          'Pick the invoice the goods came from and the quantities returned.',
          'Choose the reason. Good stock goes back to the warehouse; damaged goods go to the Damaged warehouse, so one must exist.',
          'Issue the credit note. It reduces what the customer owes.',
        ],
      },
    ],
  },
  {
    id: 'van',
    title: 'Selling from a van: stock requests and day cashout',
    roles: ['SALESMAN', 'MANAGER', 'WAREHOUSE', 'COMPANY_ADMIN'],
    body: [
      { h: 'Load the van' },
      { steps: ['The salesman asks for stock in Van Stock Requests.', 'A manager or the warehouse approves it and issues the stock.', 'The salesman confirms receipt. The stock is now in the van.'] },
      { h: 'Close the day' },
      { steps: ['Open Day Cashout, count the stock left in the van and the cash collected.', 'Submit it. A manager checks expected against actual and approves it.', 'Then check out in Attendance.'] },
    ],
  },
  {
    id: 'stock',
    title: 'Stock: checking, moving and correcting',
    roles: STOCK,
    body: [
      { list: [
        'Stock Query shows the free quantity of each product, warehouse by warehouse.',
        'Inventory has the stock on hand, stock movements, transfers between warehouses and stock adjustments.',
        'In stock movements, green is stock coming in and red is stock going out. The tiles at the top show opening stock, total in, total out and net in hand.',
        'Use an adjustment to correct a count (breakage, shortage, excess). Always add a short reason.',
      ] },
    ],
  },
  {
    id: 'purchase',
    title: 'Buying stock: purchase order to supplier payment',
    roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE'],
    body: [
      {
        steps: [
          'Purchase Orders: create the order to the supplier. The totals with tax show as you type.',
          'Goods Receipts: when goods arrive, receive them against the order. Rejected quantity cannot be more than received; accepted goods go into stock.',
          'Supplier Bills: enter the supplier\'s invoice against the receipt.',
          'Supplier Payments: pay the bill. An unused amount stays as an advance with the supplier.',
          'Purchase Returns: send goods back to the supplier against the receipt.',
        ],
      },
      { p: 'Tap any document number to view it in full.' },
    ],
  },
  {
    id: 'pricing',
    title: 'Prices, price lists, discounts and schemes',
    roles: OFFICE,
    body: [
      { list: [
        'Selling price (on the product) is the normal price used on orders and invoices.',
        'Dealer price is a reference price kept on the product and shown in the Product & Price List report. It is not applied on its own: to bill dealers at that price, put it in a price list and assign that list to the dealer customers.',
        'Price Lists hold special prices for a group of customers. A customer with a price list gets those prices; others get the selling price.',
        'Discounts are standing trade discounts by customer or customer type and by product, brand or category. The most specific rule wins.',
        'Schemes give a discount or free goods, e.g. buy 10 get 1 free.',
        'No price can be above the MRP.',
        'Price Review lists products whose cost changed after a purchase, so you can check the selling price.',
      ] },
    ],
  },
  {
    id: 'reports',
    title: 'Reports and exports',
    body: [
      { steps: ['Open Reports and pick a report.', 'Choose the period: today, this month, last month, this quarter, a financial year, or your own dates.', 'Add any other filter, then view it. With permission you can export it to Excel.'] },
      { p: 'You only see the reports your role allows. Cost and stock value figures need cost permission.' },
    ],
  },
  {
    id: 'year',
    title: 'Closing the financial year',
    roles: ['COMPANY_ADMIN', 'ACCOUNTANT'],
    body: [
      { h: 'How the year end works' },
      { list: [
        'Two weeks before the year ends, the home screen and a notification remind you to plan the stock count and clear pending work.',
        'From the first day of the new year, only admins and accountants can enter or change documents dated in the old year. Everyone else uses today\'s date. The admin can give this to another user in Users > Access ("Enter documents in an ended year").',
        'Until the old year is closed, the admin gets a reminder every week (every four weeks after two months).',
        'Document numbers start a new series by themselves (INV-2627-...). A late March bill entered in April still gets a March number.',
      ] },
      { h: 'Close the year' },
      { steps: [
        'Enter the last bills, count the stock in every godown and van, and post any difference as a stock adjustment dated inside the year.',
        'Open Year Closing. Download the draft closing pack (Excel) and check it with your CA if you like.',
        'Choose Review & close and go through the checklist: drafts, expense claims and day cashouts waiting for approval, van stock requests, stock below zero, and balances that do not match their documents.',
        'Finish the items marked with a warning. If one must stay open, you can close anyway, but you must write why.',
        'Close the year. Its documents are locked for everyone, the closing balances become the next year\'s opening balances, and the admins and accountants get a notification.',
        'Download the closing pack: year totals, and every customer, supplier and stock balance on the last day.',
      ] },
      { p: 'If something must be corrected, an admin can reopen the year with a reason, fix it and close it again. The reopen is kept in the audit trail and everyone who keeps the books is told.' },
      { p: 'A credit note for an old-year invoice can still be issued in the new year (dated in the new year), and old-year invoices can still be paid.' },
    ],
  },
  {
    id: 'team',
    title: 'Users, roles and the field team',
    roles: ['COMPANY_ADMIN', 'MANAGER'],
    body: [
      { list: [
        'Users & Teams: add staff and give each one a role: Company admin, Manager, Accountant, Warehouse or Salesman. The role decides the menu they see.',
        'Reports to: set each salesman\'s manager or team lead. A user set to "Own + team" sees the records of the people who report to them.',
        'Access (row menu, admins): give one user more or less than their role, decide whose records they see, and set their discount and approval limits.',
        'Access profiles and Who can do what (admins): shared sets of access for several users, and a list of who can do any one thing.',
        'Beat Plan: assign routes to salesmen day by day. Days you do not change follow each route\'s weekly plan. Past days are locked.',
        'Targets: revenue or activity goals for a salesman or a beat, with achievement tracking.',
        'Reports > Visit Register and Attendance: what the team did and when.',
        'Expenses: salesmen log field spends; a manager approves them and marks them paid.',
      ] },
    ],
  },
  {
    id: 'printing',
    title: 'Printing and sharing documents',
    body: [
      { h: 'Original and duplicate' },
      { p: 'Invoices, credit notes, receipts and purchase orders are key documents. The first print is marked ORIGINAL. Every later print is marked DUPLICATE COPY with a COPY watermark, so only one original is ever in circulation.' },
      { p: 'Under the document you can see how many times it was printed and whether the next print is the original or a duplicate. If you need the original again, ask your admin: an admin can print the original again or allow one more original from Print Control.' },
      { p: 'Drafts print with a DRAFT watermark and do not count. Sales orders and other print-outs are not counted.' },
      { p: 'Who may print is set per document (orders, invoices, credit notes, receipts, purchase orders). The same permission covers Print / PDF and Email, because the email carries the PDF. If you do not see Print / PDF or Email on a document, your admin has not given you that permission.' },
      { p: 'Admins set it for a whole role in Company settings → Permissions ("Print, PDF & email" under each document), or for one user under Users & Teams → Access.' },
      { h: 'Email and WhatsApp' },
      { list: [
        'Email sends the document as a PDF attachment to the customer (up to 5 addresses). An emailed PDF does not use up the original.',
        'If email is not set up for your company, "Open in mail app" writes the same message in your own mail app.',
        'WhatsApp opens a chat with the customer’s number and a short summary. To send the PDF itself, use Print / PDF and share the file.',
      ] },
    ],
  },
  {
    id: 'user-access',
    title: 'Giving one user more (or less) access',
    roles: ADMIN,
    body: [
      { p: 'Each user can do what their role can (Company settings → Permissions). When one person needs something different from the rest of their role, change it for that user only.' },
      { steps: [
        'Open Users & Teams, find the user and choose Access from the row menu.',
        'For a permission, pick Allow (this user may, even if the role may not) or Deny (this user may not, even if the role may). Role puts it back on the role.',
        'For a short need, such as covering for someone on leave, set an end date. After that day it follows the role again.',
        'To give the same access as someone else, use "Copy access from…", check it and save.',
        'Save access. It applies at once; the user is told that their access changed.',
      ] },
      { h: 'Good to know' },
      { list: [
        'Example: three presales users, the third should also add customers. Keep all three as Salesman and Allow "Customers · Create" for the third.',
        'A company admin always has full access, and nobody can change their own access.',
        'Managing users and company settings stays with company admins; it cannot be given to one user.',
        'Sensitive permissions (deletes, cancels, approvals, costs, closing the year) ask you to confirm before saving.',
        'A Presale or Van sale salesman stays limited by their sales type; change the sales type in the user’s details instead.',
        '"Who can do what" on the Users page lists everyone who can do one thing, and why.',
        'Every change is in the audit trail.',
      ] },
      { h: 'Temporary access' },
      { p: 'Pick an end date next to an Allow or Deny. On that date it ends by itself and the user follows their role (or profile) again. The Access screen lists the ones that have ended.' },
    ],
  },
  {
    id: 'records-limits',
    title: 'Whose records a user sees, and their limits',
    roles: ADMIN,
    body: [
      { p: 'Open Users & Teams → Access for a user. The box at the top holds their access profile, whose records they see and their limits.' },
      { h: 'Whose records they see' },
      { list: [
        'Own records only: their own orders, invoices, receipts, returns, customers, visits, expenses and targets.',
        'Own + their team: theirs plus those of everyone whose "Reports to" is this user.',
        'Whole company: everything.',
        'By role (default): a salesman sees their own, a manager their team, everyone else the whole company.',
        'It applies to lists, detail screens, reports and the home dashboard.',
      ] },
      { h: 'Example: a senior presales user who checks the juniors' },
      { steps: [
        'Open each junior in Users & Teams and set Reports to = the senior.',
        'Open the senior\'s Access and set Whose records they see = Own + their team.',
        'Save. The senior now sees the juniors\' orders and customers; the juniors still see only their own.',
      ] },
      { h: 'Limits' },
      { list: [
        'Max discount by hand (%): the most this user may type as a line discount. A price typed below the price list counts too, and both together are checked. Empty = no limit.',
        'Approve up to (amount): the largest order or expense this user may approve. Empty = no limit.',
        'Company admins have no limits.',
      ] },
    ],
  },
  {
    id: 'access-profiles',
    title: 'Access profiles: the same access for several users',
    roles: ADMIN,
    body: [
      { p: 'When several people need the same extra access (for example all senior presales), make a profile once instead of setting each user.' },
      { steps: [
        'Users & Teams → Access profiles → New profile.',
        'Name it, then set Allow / Deny for the permissions that differ from the role, whose records they see and the limits. Leave the rest as it is.',
        'Create the profile.',
        'Open each user\'s Access, choose the profile and save.',
      ] },
      { h: 'Good to know' },
      { list: [
        'Change the profile and it changes for everyone on it at once; they are told.',
        'A user\'s own Allow / Deny and their own records or limits setting win over the profile.',
        'Switch a profile off to stop it counting for everyone on it, without deleting it.',
        'A profile cannot be deleted while users are on it.',
        'The users list shows each user\'s profile next to their role.',
      ] },
    ],
  },
  {
    id: 'approvals',
    title: 'Approvals: maker-checker and approval limits',
    roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE'],
    body: [
      { h: 'Maker-checker' },
      { p: 'Company settings → Order rules → "Maker-checker". When it is on, nobody approves an order, expense, van stock request or day cashout they raised themselves; someone else must. Company admins are exempt, as the owner is often the only approver.' },
      { h: 'Approval limits' },
      { p: 'An admin can give each approver an "Approve up to" amount (Users & Teams → Access, or an access profile). An order or expense above it is refused for that user with a message; someone with a higher limit, or an admin, approves it.' },
      { p: 'An expense can be approved for less than was claimed; the approved amount is what is checked against the limit.' },
    ],
  },
  {
    id: 'settings-locks',
    title: 'Why some settings are locked',
    roles: ADMIN,
    body: [
      { p: 'Once the company has its first transaction (an order, invoice, payment, return, purchase, stock entry or expense), these can no longer change, because saved documents depend on them: currency, currency symbol, country, financial year start and tax regime.' },
      { p: 'Tax registration number, registered state and tax options can only be changed by your service provider.' },
    ],
  },
];

export const FAQS = [
  { q: 'How do I check in for the day?', a: 'Open Attendance and tap check in. Allow location access on your phone. Check out from the same screen at the end of the day.', roles: FIELD, k: 'attendance punch start day mark present' },
  { q: 'Why can\'t I check in to another shop?', a: 'You are still checked in at the last shop. Open Sales Visit and check out of it first.', roles: FIELD, k: 'visit stuck check out shop' },
  { q: 'How do I get directions to a shop?', a: 'In Sales Visit, tap Directions on the shop card. Google Maps opens with the way from where you are. Tap Nearest first to see the closest shops on top.', roles: FIELD, k: 'map route navigation way reach location directions google maps' },
  { q: 'Where is the visits report?', a: 'Reports > Register Reports > Visit Register. It shows check-in and check-out times, time at the shop, where the rep checked in, outcome and no-order reason, and exports to Excel.', roles: ['COMPANY_ADMIN', 'MANAGER'], k: 'visits report register field activity check in' },
  { q: 'Why does it say I am too far from the shop?', a: 'Your company only allows shop check-in near the shop\'s saved location. Go to the shop, or ask your manager to correct the shop location.', roles: FIELD, k: 'geofence location distance gps far' },
  { q: 'How do I book an order?', a: 'Open Orders (My Orders) or Sales Visit, choose the customer, add products and quantities, then save or submit. Prices, discounts and schemes apply on their own.', k: 'new order booking sale' },
  { q: 'How do I take a payment from a shop?', a: 'Open Payments & Collections (My Collections), choose the customer, enter the amount and mode, set it against their open invoices and save.', roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'SALESMAN'], k: 'collection receipt cash cheque upi money received' },
  { q: 'Why can\'t I change the price?', a: 'A price cannot go above the product\'s MRP, some roles cannot change prices at all, and your admin may have set a limit on how much discount you can give. Ask your manager if the price looks wrong.', k: 'rate edit price mrp' },
  { q: 'Why does it say I can give at most some % discount?', a: 'Your admin has set a limit on the discount you can type by hand. A price typed below the price list counts as a discount too. Keep within it, or ask someone with a higher limit to book it.', k: 'discount limit percent maximum refused price cut' },
  { q: 'Why can\'t I change the tax rate on a line?', a: 'The tax rate comes from the product. Ask your admin to correct it on the product if it is wrong.', k: 'gst vat tax percent rate' },
  { q: 'When does stock go out on a sale?', a: 'When the invoice is issued. There is no separate dispatch step.', k: 'dispatch stock reduce invoice' },
  { q: 'How do I return goods from a customer?', a: 'Create a credit note (My Returns) against the invoice, pick the quantities and the reason, then issue it. Damaged goods go to the Damaged warehouse.', roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'SALESMAN'], k: 'return credit note damage expiry' },
  { q: 'What is the dealer price on a product?', a: 'A reference price kept on the product and shown in the Product & Price List report. It is not applied on orders or invoices on its own. To bill dealers at that price, put it in a price list and assign the list to those customers.', roles: OFFICE, k: 'dealer price product master wholesale' },
  { q: 'How do I give some customers a special price?', a: 'Create a price list with those prices in Price Lists, then assign it to the customers on their customer record.', roles: OFFICE, k: 'special rate price list dealer wholesale' },
  { q: 'How do I see how much stock is left?', a: 'Stock Query shows the free quantity of each product in each warehouse. Inventory shows stock on hand and every movement.', roles: [...STOCK, 'SALESMAN'], k: 'stock balance available quantity left' },
  { q: 'What do green and red mean in stock movements?', a: 'Green is stock coming in, red is stock going out. A cancelled purchase return puts stock back in, so it shows green.', roles: STOCK, k: 'colour color movement report in out' },
  { q: 'How do I get stock into my van?', a: 'Ask for it in Van Stock Requests. After a manager issues it, confirm receipt on the same screen.', roles: ['SALESMAN', 'MANAGER', 'WAREHOUSE', 'COMPANY_ADMIN'], k: 'van load request stock' },
  { q: 'How do I close my day on the van?', a: 'Open Day Cashout, count the stock and cash, and submit. After a manager approves it, check out in Attendance.', roles: ['SALESMAN', 'MANAGER'], k: 'cashout cash handover end of day van' },
  { q: 'How do I claim an expense?', a: 'Open Expenses, add the spend with its amount, and submit it. Your manager approves it and marks it paid.', roles: ['SALESMAN', 'MANAGER', 'COMPANY_ADMIN', 'ACCOUNTANT'], k: 'expense claim travel fuel reimburse' },
  { q: 'Why can\'t I change the currency or financial year?', a: 'They lock after the company\'s first transaction, because saved documents depend on them. The same goes for the currency symbol, country and tax regime.', roles: ADMIN, k: 'locked currency symbol country financial year tax regime settings' },
  { q: 'Why can\'t I use last year\'s date?', a: 'The financial year has ended. Until it is closed, only admins and accountants can enter documents dated in it. Use today\'s date, or ask your accountant to enter it.', roles: ['MANAGER', 'SALESMAN', 'WAREHOUSE', 'ACCOUNTANT'], k: 'previous year back date old date march april ended locked' },
  { q: 'What does the closing pack contain?', a: 'An Excel file with the year totals (sales, tax, profit, purchases, collections) and every customer, supplier and stock balance on the last day. Before closing it is marked as a draft.', roles: ['COMPANY_ADMIN', 'ACCOUNTANT'], k: 'year end closing balances excel auditor ca export' },
  { q: 'Why can\'t I close the year?', a: 'Some checklist items still need attention. Finish them, or choose Close anyway and write why. Only an admin can close a year, and years close in order.', roles: ['COMPANY_ADMIN', 'ACCOUNTANT'], k: 'year closing blocked checklist close anyway' },
  { q: 'Why can\'t I edit an old invoice?', a: 'Its financial year may be closed, or the invoice is already issued. A closed year must be reopened by an admin before anything in it can change.', roles: OFFICE, k: 'locked old edit year closed' },
  { q: 'How do I export a report to Excel?', a: 'Open the report, set the period and filters, then use Export. You need export permission.', roles: OFFICE, k: 'excel download export report' },
  { q: 'How do I give one salesman more access than the others?', a: 'Users & Teams → that user\'s row menu → Access. Set Allow on what they need and save. The others in the role stay as they are.', roles: ADMIN, k: 'extra access one user allow permission senior salesman' },
  { q: 'How do I let a senior salesman see the team\'s orders?', a: 'Set Reports to = the senior on each junior, then in the senior\'s Access set Whose records they see = Own + their team.', roles: ADMIN, k: 'team lead see team orders records senior scope' },
  { q: 'How do I give the same access to several people?', a: 'Make an access profile (Users & Teams → Access profiles) and choose it in each user\'s Access. Changing the profile changes it for all of them.', roles: ADMIN, k: 'profile group same access many users' },
  { q: 'How do I give access for a few days only?', a: 'In the user\'s Access, set Allow and pick an end date. It ends by itself after that day.', roles: ADMIN, k: 'temporary access leave cover end date days' },
  { q: 'Who can print invoices (or do anything else)?', a: 'Users & Teams → Who can do what. Pick the permission to see everyone who can, who cannot, and why.', roles: ADMIN, k: 'who can permission list print approve report' },
  { q: 'How do I add a new user?', a: 'Open Users & Teams, add the person with their email or phone and role. They get their first password and must change it when they first sign in.', roles: ADMIN, k: 'staff employee salesman add user invite' },
  { q: 'Why is a screen missing from my menu?', a: 'Your role, or the access your admin set for you, does not include it. Ask your admin if you need it.', k: 'menu missing access permission not showing' },
  { q: 'Why do I see only my own orders or customers?', a: 'You see the records your admin set for you: your own, your team\'s, or the whole company\'s. By default a salesman sees their own and a manager their team. Ask your admin if you need more.', k: 'only my own records team see others orders customers data scope' },
  { q: 'It says my access was updated. What changed?', a: 'Your admin changed what you can do. Some buttons or menus may have appeared or gone. Ask your admin for the details.', k: 'access updated changed permission notification' },
  { q: 'Why is Print / PDF or Email missing on a document?', a: 'Printing is allowed per document type, and Email needs the same permission because it sends the PDF. Ask your admin to allow it.', k: 'print pdf email button missing not showing' },
  { q: 'Why can\'t I approve this?', a: 'Either it is above your approval limit, or your company uses maker-checker and you raised it yourself. Someone else, or someone with a higher limit, must approve it.', roles: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE'], k: 'approve refused limit maker checker own order expense' },
  { q: 'I forgot my password', a: 'On the sign-in page tap "Forgot password?" and follow the steps, or ask your admin to reset it.', k: 'password reset forgot login sign in' },
  { q: 'Why does my print say DUPLICATE COPY?', a: 'The document was already printed once. Only the first print is the original; ask your admin if you need the original again.', k: 'duplicate copy original reprint watermark print' },
  { q: 'How do I send an invoice to a customer?', a: 'Open the invoice and tap Email (sends the PDF) or WhatsApp (sends a short summary to the customer’s number).', k: 'email whatsapp share send invoice pdf' },
  { q: 'Can I use it on my phone?', a: 'Yes. Open it in the phone browser and use "Install" to add it to your home screen like an app.', k: 'mobile phone install app android' },
];

/** Entries visible to a role (no role yet = show everything). */
export const forRole = (items, role) => items.filter((i) => !i.roles || !role || i.roles.includes(role));
