const mongoose = require("mongoose");

let transactionsSupported = false;

const connectDB = async () => {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri || mongoUri.includes("username:password")) {
        console.warn("MongoDB is not configured. Running without a database connection.");
        return false;
    }

    try {
        await mongoose.connect(mongoUri);
        const topology = await mongoose.connection.db.admin().command({ hello: 1 });
        transactionsSupported = Boolean(topology.setName || topology.msg === "isdbgrid");

        console.log("MongoDB connected successfully");
        return true;
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        throw error;
    }
};

connectDB.getCapabilities = () => ({ transactionsSupported });

module.exports = connectDB;