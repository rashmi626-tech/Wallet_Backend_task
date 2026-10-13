const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
	name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
	email: { type: String, required: true, unique: true, lowercase: true, trim: true },
	passwordHash: { type: String, required: true, select: false },
	role: { type: String, enum: ["user", "admin"], default: "user", required: true },
	requiresAdditionalVerification: { type: Boolean, default: false, required: true }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
