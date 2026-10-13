const errorMiddleware = (error, req, res, next) => {
	if (res.headersSent) return next(error);

	let statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
	let message = error.expose === true
		? error.message
		: "An unexpected server error occurred.";

	if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
		statusCode = 400;
		message = "Request body must contain valid JSON.";
	} else if (error.name === "ValidationError" || error.name === "CastError") {
		statusCode = 400;
		message = "Request contains invalid data.";
	} else if (error.code === 11000) {
		statusCode = 409;
		message = "This request conflicts with an existing record.";
	}

	if (statusCode >= 500) console.error("API request failed:", error.message);

	return res.status(statusCode).json({ message });
};

module.exports = errorMiddleware;
