require("dotenv").config();

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const assertLocalMongoUri = require("./localMongoUri");

const provisionAdmin = async () => {
	if (process.env.NODE_ENV === "production") {
		throw new Error("Administrator provisioning is disabled in production.");
	}
	const mongoUri = assertLocalMongoUri(process.env.MONGO_URI);
	const name = typeof process.env.ADMIN_NAME === "string" ? process.env.ADMIN_NAME.trim() : "";
	const email = typeof process.env.ADMIN_EMAIL === "string" ? process.env.ADMIN_EMAIL.trim().toLowerCase() : "";
	const password = process.env.ADMIN_PASSWORD || "";
	if (name.length < 2 || name.length > 80 || !/^\S+@\S+\.\S+$/.test(email)
		|| password.length < 12 || password.startsWith("replace-with-")) {
		throw new Error("Set ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters.");
	}

	await mongoose.connect(mongoUri);
	const passwordHash = await bcrypt.hash(password, 12);
	await User.findOneAndUpdate(
		{ email },
		{ $set: { name, email, passwordHash, role: "admin" } },
		{ upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
	);
	console.log(`Local administrator ${email} is ready.`);
};

provisionAdmin()
	.catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	})
	.finally(() => mongoose.disconnect());
