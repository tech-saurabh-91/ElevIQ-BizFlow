/**
 * Phone card tables (table.table-cards, see index.css) label each value with
 * its column header. Rather than every page passing data-label by hand, one
 * observer fills in data-label (and data-actions for a menu column) on any
 * card table as rows appear.
 */
// Cells without their own data-label take the text of their column header;
// a cell under an empty / "Actions" header is the row menu (data-actions).
function labelCells(table) {
  const heads = [...(table.tHead?.rows[0]?.cells || [])].map((th) => th.textContent.trim());
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      if (row.cells.length !== heads.length) continue; // empty / loading rows
      [...row.cells].forEach((td, i) => {
        if (!td.hasAttribute('data-label') && heads[i]) td.setAttribute('data-label', heads[i]);
        if (i > 0 && /^(actions?)?$/i.test(heads[i]) && td.querySelector('button, a')) td.setAttribute('data-actions', '');
      });
    }
  }
}

export function watchCardTables(root = document.body) {
  // Only attributes are written, and only childList is observed: no loop.
  const run = () => root.querySelectorAll('table.table-cards').forEach(labelCells);
  const mo = new MutationObserver(run);
  mo.observe(root, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
