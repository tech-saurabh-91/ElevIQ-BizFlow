import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';

/**
 * Builds every index declared in src/models on the database in MONGO_URI.
 *
 * autoIndex is off in production (so cold starts don't fire index builds),
 * which means new indexes only reach the live database through this script.
 * Without them every list / dashboard query scans the whole collection and
 * gets slower as data grows.
 *
 *   npm run indexes            build missing indexes (existing ones untouched)
 *   npm run indexes -- --check only list what is missing, change nothing
 *
 * Safe to re-run. It never drops an index. Builds run in the background on
 * Atlas, so the app keeps working meanwhile.
 */

const checkOnly = process.argv.includes('--check');
const modelsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/models');
const SKIP = new Set(['common.js', 'helpers.js']);

const keyOf = (spec) => JSON.stringify(spec);

const run = async () => {
  await connectDB(1, 1000);

  for (const file of fs.readdirSync(modelsDir).sort()) {
    if (!file.endsWith('.js') || SKIP.has(file)) continue;
    await import(pathToFileURL(path.join(modelsDir, file)).href);
  }

  let missingTotal = 0;
  let failed = 0;
  for (const name of mongoose.modelNames().sort()) {
    const model = mongoose.model(name);
    let existing = [];
    try {
      existing = (await model.collection.indexes()).map((i) => keyOf(i.key));
    } catch {
      existing = []; // collection does not exist yet
    }
    const wanted = model.schema.indexes().map(([spec]) => keyOf(spec));
    const missing = wanted.filter((k) => !existing.includes(k));
    missingTotal += missing.length;
    if (!missing.length) continue;

    console.log(`${name}: ${missing.length} missing -> ${missing.join('  ')}`);
    if (checkOnly) continue;
    try {
      await model.createIndexes();
      console.log(`  ${name}: done`);
    } catch (err) {
      failed += 1;
      // Usually a unique index blocked by duplicate rows; the rest still build.
      console.error(`  ${name}: FAILED - ${err.message}`);
    }
  }

  console.log(
    missingTotal === 0
      ? 'All indexes are in place.'
      : checkOnly
        ? `${missingTotal} index(es) missing. Run without --check to build them.`
        : `Finished. ${failed ? `${failed} model(s) failed, see above.` : 'All built.'}`
  );
  await disconnectDB();
};

run().catch(async (err) => {
  console.error(err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
