const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");

const requireAuth = async (req, res, next) => {
	const authorization = req.get("authorization");
	const token = typeof authorization === "string" ? authorization.match(/^Bearer\s+(\S+)$/i)?.[1] : null;

	if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
		return res.status(503).json({ message: "Configure a JWT_SECRET with at least 32 characters." });
	}

	if (!token) {
		return res.status(401).json({ message: "Authentication required." });
	}

	let payload;
	try {
		payload = jwt.verify(token, process.env.JWT_SECRET);
	} catch {
		return res.status(401).json({ message: "Authentication required." });
	}

	if (!payload || typeof payload !== "object" || typeof payload.sub !== "string" || !mongoose.Types.ObjectId.isValid(payload.sub)) {
		return res.status(401).json({ message: "Authentication required." });
	}
	const user = await User.findById(payload.sub).select("name email role requiresAdditionalVerification");
	if (!user) return res.status(401).json({ message: "Authentication required." });

	req.user = user;
	return next();
};

module.exports = requireAuth;
