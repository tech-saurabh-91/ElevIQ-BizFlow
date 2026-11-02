/**
 * TEMPORARY maintenance helper (Phase 8 live verification) - delete before commit.
 * Reads/writes the notifications collection directly so the UI can be exercised
 * against real Atlas data. Usage:
 *   node _tmp_notify_state.mjs dump    <outfile>
 *   node _tmp_notify_state.mjs unread
 *   node _tmp_notify_state.mjs restore <infile>
 */
import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';

const [mode, arg] = process.argv.slice(2);

if (!process.env.MONGO_URI) {
  console.error('MONGO_URI not set');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI, {
  dbName: process.env.DB_NAME || 'SFA_ERP',
  serverSelectionTimeoutMS: 10000,
});

const col = mongoose.connection.db.collection('notifications');

if (mode === 'dump') {
  const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
  fs.writeFileSync(arg, JSON.stringify(docs, null, 2));
  console.log(`dumped ${docs.length} notifications -> ${arg}`);
} else if (mode === 'unread') {
  const r = await col.updateMany({}, { $set: { isRead: false, readAt: null } });
  console.log(`reset ${r.modifiedCount} notifications to unread`);
} else if (mode === 'restore') {
  const docs = JSON.parse(fs.readFileSync(arg, 'utf8'));
  let inserted = 0;
  for (const d of docs) {
    const exists = await col.findOne({ _id: d._id });
    if (!exists) {
      await col.insertOne(d);
      inserted += 1;
    }
  }
  const r = await col.updateMany({}, { $set: { isRead: false, readAt: null } });
  console.log(`restored ${inserted} deleted notifications; ${r.modifiedCount} reset to unread`);
} else {
  console.error('unknown mode');
  process.exit(1);
}

await mongoose.disconnect();
