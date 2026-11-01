import mongoose from 'mongoose';
import env from './env.js';
import '../models/plugins/queryHelpers.js'; // global Query.prototype helpers
import logger from '../utils/logger.js';

mongoose.set('strictQuery', true);

/**
 * Connect to MongoDB using ONLY MONGO_URI + DB_NAME from env.
 * Retries with exponential backoff so a transient Atlas hiccup doesn't crash us.
 */
export const connectDB = async (retries = 5, delayMs = 3000) => {
  try {
    const options = {
      dbName: env.dbName,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 20,
      autoIndex: !env.isProd, // build indexes in dev; use migration/syncIndexes in prod
    };

    const conn = await mongoose.connect(env.mongoUri, options);

    logger.info(`MongoDB connected: ${conn.connection.host} | db=${env.dbName}`);

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err.message);
    });
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Waiting to reconnect...');
    });
    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected.');
    });

    return conn;
  } catch (error) {
    if (retries <= 0) {
      logger.error('MongoDB connection failed after all retries:', error.message);
      throw error;
    }
    logger.warn(`MongoDB connect failed. Retrying in ${delayMs}ms... (${retries} left)`);
    await new Promise((r) => setTimeout(r, delayMs));
    return connectDB(retries - 1, delayMs * 2);
  }
};

export const disconnectDB = async () => {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed.');
};

export default connectDB;
