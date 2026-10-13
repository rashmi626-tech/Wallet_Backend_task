const requireAdditionalVerification = (req, res, next) => {
	if (req.user?.requiresAdditionalVerification) {
		return res.status(403).json({ message: "This request requires additional verification." });
	}
	return next();
};

module.exports = requireAdditionalVerification;
