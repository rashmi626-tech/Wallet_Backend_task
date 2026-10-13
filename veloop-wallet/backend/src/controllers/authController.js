const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

const serializeWallet = (wallet) => ({
	currency: wallet?.currency || "USD",
	balanceCents: wallet?.balanceCents ?? 0,
	ves: wallet?.ves ?? 0,
	sves: wallet?.sves ?? 0,
	gems: wallet?.gems ?? 0,
	tokens: wallet?.tokens ?? 0,
	spins: wallet?.spins ?? 0
});

const issueToken = (user) => jwt.sign(
	{ sub: user.id },
	process.env.JWT_SECRET,
	{ expiresIn: "12h" }
);

const getConfiguredDefaultAccount = () => {
	const email = typeof process.env.DEFAULT_EMAIL === "string" ? process.env.DEFAULT_EMAIL.trim().toLowerCase() : "";
	const password = typeof process.env.DEFAULT_PASSWORD === "string" ? process.env.DEFAULT_PASSWORD : "";
	const name = typeof process.env.DEFAULT_NAME === "string" ? process.env.DEFAULT_NAME.trim() : "Local Admin";

	if (!email || !password) {
		return null;
	}

	return { email, password, name };
};

const register = async (req, res) => {
	if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
		return res.status(503).json({ message: "Configure a JWT_SECRET with at least 32 characters." });
	}

	const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
	const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
	const password = typeof req.body.password === "string" ? req.body.password : "";

	if (name.length < 2 || name.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
		return res.status(400).json({ message: "Enter a name, valid email, and password with at least 8 characters." });
	}

	try {
		const passwordHash = await bcrypt.hash(password, 12);
		const user = await User.create({ name, email, passwordHash });
		const wallet = await Wallet.create({ userId: user._id });

		return res.status(201).json({
			token: issueToken(user),
			user: { name: user.name, email: user.email },
			wallet: serializeWallet(wallet)
		});
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: "An account with this email already exists." });
		}

		console.error("Account registration failed:", error.message);
		return res.status(500).json({ message: "Unable to create your account." });
	}
};

const login = async (req, res) => {
	if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
		return res.status(503).json({ message: "Configure a JWT_SECRET with at least 32 characters." });
	}

	const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
	const password = typeof req.body.password === "string" ? req.body.password : "";
	const configuredDefault = getConfiguredDefaultAccount();

	if (configuredDefault && email === configuredDefault.email && password === configuredDefault.password) {
		let user = await User.findOne({ email: configuredDefault.email }).select("+passwordHash");
		if (!user) {
			const passwordHash = await bcrypt.hash(configuredDefault.password, 12);
			user = await User.create({
				name: configuredDefault.name,
				email: configuredDefault.email,
				passwordHash,
				role: "admin"
			});
		}

		const wallet = await Wallet.findOneAndUpdate(
			{ userId: user._id },
			{ $setOnInsert: { userId: user._id } },
			{ new: true, upsert: true, setDefaultsOnInsert: true }
		);

		return res.json({
			token: issueToken(user),
			user: { name: user.name, email: user.email },
			wallet: serializeWallet(wallet)
		});
	}

	const user = await User.findOne({ email }).select("+passwordHash");

	if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
		return res.status(401).json({ message: "Email or password is incorrect." });
	}

	const wallet = await Wallet.findOneAndUpdate(
		{ userId: user._id },
		{ $setOnInsert: { userId: user._id } },
		{ new: true, upsert: true, setDefaultsOnInsert: true }
	);

	return res.json({
		token: issueToken(user),
		user: { name: user.name, email: user.email },
		wallet: serializeWallet(wallet)
	});
};

const currentUser = async (req, res) => {
	const wallet = await Wallet.findOne({ userId: req.user._id });

	if (!wallet) {
		return res.status(404).json({ message: "Wallet not found." });
	}

	return res.json({
		user: { name: req.user.name, email: req.user.email },
		wallet: serializeWallet(wallet)
	});
};

module.exports = { register, login, currentUser };
