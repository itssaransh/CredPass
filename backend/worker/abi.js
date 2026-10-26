// Minimal ABI for the parts of CredPassLendingPool the Worker needs.
// Keeping it hand-written (instead of bundling the full Hardhat artifact)
// keeps the Worker bundle small and avoids importing files from disk.
export const POOL_ABI = [
    'function getLoan(address borrower) view returns (address borrowerAddr, uint256 principal, uint256 repaymentDueVal, string tierVal, bool repaidVal)',
    'function tierLimits(string tier) view returns (uint256)',
    'function tierRates(string tier) view returns (uint256)',
    'event LoanRepaid(address borrower, uint256 amount)',
];
