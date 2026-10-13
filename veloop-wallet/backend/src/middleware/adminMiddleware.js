const requireAdmin = (req, res, next) => {
	if (!req.user) return res.status(401).json({ message: "Authentication required." });
	if (req.user.role !== "admin") return res.status(403).json({ message: "Administrator access required." });
	return next();
};

module.exports = requireAdmin;
