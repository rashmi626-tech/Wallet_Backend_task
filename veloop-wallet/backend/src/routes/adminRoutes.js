const express = require("express");
const requireAuth = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/adminMiddleware");
const {
	listWithdrawals,
	getWithdrawal,
	approveWithdrawal,
	rejectWithdrawal,
	listTransactions,
	listAuditLogs,
	creditWallet,
	debitWallet,
	correctWalletBalance,
	configurePayoutOption
} = require("../controllers/adminController");

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get("/withdrawals", listWithdrawals);
router.get("/withdrawals/:withdrawalId", getWithdrawal);
router.post("/withdrawals/:withdrawalId/approve", approveWithdrawal);
router.post("/withdrawals/:withdrawalId/reject", rejectWithdrawal);
router.get("/transactions", listTransactions);
router.get("/audit-logs", listAuditLogs);
router.patch("/payout-options/:code", configurePayoutOption);
router.post("/wallet/credit", creditWallet);
router.post("/wallet/debit", debitWallet);
router.post("/wallet/correct", correctWalletBalance);

module.exports = router;
