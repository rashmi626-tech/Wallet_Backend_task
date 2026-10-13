const assertLocalMongoUri = (mongoUri) => {
	if (typeof mongoUri !== "string" || !mongoUri) {
		throw new Error("MONGO_URI must point to a local development MongoDB instance.");
	}

	let parsed;
	try {
		parsed = new URL(mongoUri);
	} catch {
		throw new Error("MONGO_URI must be a valid local MongoDB URI.");
	}

	if (parsed.protocol !== "mongodb:"
		|| !["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)) {
		throw new Error("This script only connects to MongoDB on the local machine.");
	}
	return mongoUri;
};

module.exports = assertLocalMongoUri;
