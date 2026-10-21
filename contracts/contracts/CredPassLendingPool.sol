// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract CredPassLendingPool {
    address public evaluator;
    // Deployer is the owner: only the owner may change tier parameters.
    address public owner;

    // Credentials older than this are rejected (issuedAt is part of the
    // signed EIP-712 struct, so expiry is cryptographically bound).
    uint256 public constant CREDENTIAL_MAX_AGE = 1 days;

    // Manual minimal reentrancy guard
    bool private locked;
    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Tier limits in wei (ETH-denominated, scaled from USD rules)
    mapping(string => uint256) public tierLimits;
    // Tier rates as basis points * 100 (e.g. 350 = 3.5%)
    mapping(string => uint256) public tierRates;

    // Loan state per borrower address
    struct Loan {
        address borrower;
        uint256 principal;
        uint256 repaymentDue;
        string tier;
        bool repaid;
        bytes32 tierHash; // credential hash that issued this loan
    }

    mapping(address => Loan) public loans;
    mapping(bytes32 => bool) public usedCredentials;

    // ---------------------------------------------------------------------------
    // Depositor economics (IMPROVEMENT_PLAN.md item 10): interest sharing.
    // Deposits are tracked in a registry; every repayment distributes the
    // interest principal (msg.value - loan.principal) proportionally to each
    // depositor's share of totalDeposits at that moment, accumulated in
    // interestCredit and claimable via claim(). Prototype simplifications:
    // O(depositors) loop per repayment; rounding dust stays in the pool; a
    // claim while a loan keeps principal outstanding can temporarily reduce
    // borrowable liquidity (borrows still guard with Insufficient liquidity).
    // ---------------------------------------------------------------------------
    mapping(address => uint256) public deposits;          // depositor principal book
    mapping(address => uint256) public interestCredit;    // accrued-but-unclaimed interest (wei)
    mapping(address => bool) private isDepositor;
    address[] private depositorList;
    uint256 public totalDeposits;
    uint256 public totalInterestEarned;

    event InterestCredited(address indexed depositor, uint256 amount);
    event InterestClaimed(address indexed depositor, uint256 amount);

    event LoanIssued(address borrower, uint256 amount, bytes32 tierHash, string tier, uint256 rate);
    event LoanRepaid(address borrower, uint256 amount);
    event Deposited(address depositor, uint256 amount);

    constructor(address _evaluator) {
        evaluator = _evaluator;
        owner = msg.sender;
        // Tier A: >=3 records, total >=5000 USD, avg >=1500 USD
        // Tier B: >=1 record, total >=1000 USD, avg >=500 USD
        // Tier C: weak/no records
        // ETH mapping: A=5 ETH, B=1.5 ETH, C=0.2 ETH
        tierLimits["A"] = 5 ether;
        tierLimits["B"] = 1500000000000000000; // 1.5 ETH
        tierLimits["C"] = 200000000000000000;  // 0.2 ETH
        tierRates["A"] = 350; // 3.5%
        tierRates["B"] = 800; // 8%
        tierRates["C"] = 1800; // 18%
    }

    receive() external payable {
        _accountDeposit();
        emit Deposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        _accountDeposit();
        emit Deposited(msg.sender, msg.value);
    }

    // Depositor-only accounting: this must never run for contract-internal
    // fund movement (loan disbursements / repay handling), only for external
    // funding received via/deposit or a plain send.
    function _accountDeposit() internal {
        if (!isDepositor[msg.sender]) {
            isDepositor[msg.sender] = true;
            depositorList.push(msg.sender);
        }
        deposits[msg.sender] += msg.value;
        totalDeposits += msg.value;
    }

    // Proportional distribution of repayment interest over the deposit book.
    // Called by repay() for (msg.value - loan.principal).
    function _distributeInterest(uint256 interest) internal {
        totalInterestEarned += interest;
        if (totalDeposits == 0) return;
        for (uint256 i = 0; i < depositorList.length; i++) {
            address d = depositorList[i];
            uint256 share = (interest * deposits[d]) / totalDeposits;
            if (share > 0) {
                interestCredit[d] += share;
                emit InterestCredited(d, share);
            }
        }
    }

    // Withdraw accrued interest. Unclaimed interest is held by the pool
    // (repaid loans returned principal + interest); claiming therefore reduces
    // getLiquidity() by the claimed amount.
    function claim() external nonReentrant {
        uint256 amount = interestCredit[msg.sender];
        require(amount > 0, "Nothing to claim");
        interestCredit[msg.sender] = 0;
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "ETH transfer failed");
        emit InterestClaimed(msg.sender, amount);
    }

    // View: accrued-but-unclaimed interest for a depositor.
    function earned(address depositor) external view returns (uint256) {
        return interestCredit[depositor];
    }

    // Single source of truth for tier terms: owner-only updates, sane guards.
    // Rates are basis points (350 = 3.5%), limits are wei and must be positive.
    function setTierParams(string calldata tier, uint256 limit, uint256 rate) external onlyOwner {
        require(bytes(tier).length > 0, "Tier required");
        require(limit > 0, "Limit must be positive");
        require(rate > 0 && rate <= 10000, "Rate must be 1..10000 bps");
        tierLimits[tier] = limit;
        tierRates[tier] = rate;
    }

    function getLiquidity() external view returns (uint256) {
        return address(this).balance;
    }

    function _hashCredential(string memory tier, address userAddress, uint256 issuedAt) internal pure returns (bytes32) {
        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version)"),
            keccak256(bytes("CredPass")),
            keccak256(bytes("1"))
        ));
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Credential(string tier,address userAddress,uint256 issuedAt)"),
            keccak256(bytes(tier)),
            userAddress,
            issuedAt
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _splitSignature(bytes memory sig) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        require(sig.length == 65, "Invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) {
            v += 27;
        }
    }

    function verifyAndIssueLoan(
        string memory tier,
        address userAddress,
        uint256 issuedAt,
        bytes32 tierHash,
        bytes memory signature
    ) external nonReentrant {
        bytes32 expectedHash = _hashCredential(tier, userAddress, issuedAt);
        require(tierHash == expectedHash, "Credential hash mismatch");

        bytes32 digest = tierHash;
        (uint8 v, bytes32 r, bytes32 s) = _splitSignature(signature);
        address signer = ecrecover(digest, v, r, s);
        require(signer == evaluator, "Invalid credential signer");
        require(signer != address(0), "Invalid signature recovery");

        // Freshness: issuedAt is signed inside the credential, so expiry is
        // cryptographically bound (tampering changes the hash and fails first).
        require(issuedAt <= block.timestamp, "Credential issuedAt in future");
        require(block.timestamp - issuedAt <= CREDENTIAL_MAX_AGE, "Credential expired");

        require(msg.sender == userAddress, "Caller does not match credential wallet");
        require(bytes(tier).length > 0, "Unknown tier");
        require(tierLimits[tier] > 0, "Ineligible tier");
        // Replay protection: a credential hash is single-use, EXCEPT when the
        // borrower fully repaid the loan that was issued with this exact
        // credential (the repay → re-borrow lifecycle reuses the same signed
        // credential; a re-issued credential has a new issuedAt and new hash).
        Loan storage prevLoan = loans[msg.sender];
        require(prevLoan.borrower == address(0) || prevLoan.repaid, "Active loan exists");
        // Replay protection: a credential hash is single-use, EXCEPT when the
        // borrower fully repaid the loan that was issued with this exact
        // credential (the repay → re-borrow lifecycle reuses the same signed
        // credential; a re-issued credential has a new issuedAt and new hash).
        bool repaidWithSameCredential = prevLoan.borrower == msg.sender &&
            prevLoan.repaid &&
            prevLoan.tierHash == tierHash;
        require(usedCredentials[tierHash] == false || repaidWithSameCredential, "Credential replay");

        uint256 limit = tierLimits[tier];
        uint256 rate = tierRates[tier];
        uint256 liquidity = address(this).balance;
        require(liquidity >= limit, "Insufficient liquidity");

        uint256 repaymentDue = (limit * (10000 + rate)) / 10000;

        usedCredentials[tierHash] = true;
        loans[msg.sender] = Loan({
            borrower: msg.sender,
            principal: limit,
            repaymentDue: repaymentDue,
            tier: tier,
            repaid: false,
            tierHash: tierHash
        });

        emit LoanIssued(msg.sender, limit, tierHash, tier, rate);

        (bool sent, ) = msg.sender.call{value: limit}("");
        require(sent, "ETH transfer failed");
    }

    function repay(bytes32 tierHash) external payable nonReentrant {
        Loan storage loanData = loans[msg.sender];
        require(loanData.borrower == msg.sender, "No active loan for caller");
        require(!loanData.repaid, "Loan already repaid");
        require(msg.value == loanData.repaymentDue, "Exact repayment amount required");
        // Repayment must present the exact credential hash that issued the
        // active loan (hashes embed issuedAt, so it is stored on the loan).
        require(tierHash == loanData.tierHash, "Tier hash does not match active loan");

        loanData.repaid = true;

        // Depositor economics: interest = repaid back minus principal lent.
        // repaymentDue is always principal * (10000 + rate) / 10000, so this is
        // strictly positive; distribute it proportionally over depositors.
        uint256 interest = msg.value - loanData.principal;
        if (interest > 0) {
            _distributeInterest(interest);
        }

        emit LoanRepaid(msg.sender, msg.value);
    }

    function getLoan(address borrower) external view returns (
        address borrowerAddr,
        uint256 principal,
        uint256 repaymentDueVal,
        string memory tierVal,
        bool repaidVal
    ) {
        Loan storage l = loans[borrower];
        return (l.borrower, l.principal, l.repaymentDue, l.tier, l.repaid);
    }
}
