import mongoose from "mongoose";

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "test", // ✅ use your actual database name
      maxPoolSize: 20, // maximum concurrent connections
      minPoolSize: 5, // minimum idle connections
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(
      "✅ MongoDB connected with pooling",
      mongoose.connection.db.databaseName
    );
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
};

export default connectDB;
