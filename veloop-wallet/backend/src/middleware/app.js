const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const connectDB = require("../config/database");
const authRoutes = require("../routes/authRoutes");
const walletRoutes = require("../routes/walletRoutes");
const adminRoutes = require("../routes/adminRoutes");
const webhookRoutes = require("../routes/webhookRoutes");
const errorMiddleware = require("./errorMiddleware");

const app = express();

app.use(cors());
app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
app.use("/webhooks", webhookRoutes);

app.use("/auth", (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ message: "Database is not connected. Configure MONGO_URI first." });
    }
    next();
}, authRoutes);
app.use("/wallet", (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ message: "Database is not connected. Configure MONGO_URI first." });
    }
    next();
}, walletRoutes);
app.use("/admin", (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ message: "Database is not connected. Configure MONGO_URI first." });
    }
    next();
}, adminRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "VELoop Wallet API is running"
    });
});

app.get("/health", (req, res) => {
    const databaseConnected = mongoose.connection.readyState === 1;
    const authenticationConfigured = Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32);

    res.json({
        success: true,
        message: "VELoop Wallet API is running",
        authenticationConfigured,
        database: {
            connected: databaseConnected,
            state: mongoose.connection.readyState,
            transactionsSupported: connectDB.getCapabilities().transactionsSupported
        }
    });
});

app.use((req, res) => res.status(404).json({ message: "API route not found." }));
app.use(errorMiddleware);

module.exports = app;
