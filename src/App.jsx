import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, formatEther, parseEther } from 'ethers';
import CredentialFlow from './CredentialFlow';
import { useWallet } from './useWallet';
import abiJson from '../contracts/artifacts/contracts/CredPassLendingPool.sol/CredPassLendingPool.json';
import deployConfig from '../contracts/config/deploy-local.json';

const CONTRACT_ADDRESS = deployConfig.contractAddress;
const ABI = abiJson.abi;

const FALLBACK_TIER_MAP = {
  A: { maxETH: '5', ratePercent: '3.5' },
  B: { maxETH: '1.5', ratePercent: '8' },
  C: { maxETH: '0.2', ratePercent: '18' },
};

function friendlyTxError(e) {
  const raw = String((e && (e.reason || e.shortMessage || e.message)) || e || '');
  const code = e && e.code;
  if (code === 4001 || code === 'ACTION_REJECTED' || /user rejected|user denied/i.test(raw)) {
    return 'Transaction was rejected in MetaMask.';
  }
  if (/insufficient funds|not enough ether|exceeds (account )?balance/i.test(raw)) {
    return 'Not enough ETH in your wallet for this transaction (principal + gas).';
  }
  if (/Credential replay/i.test(raw)) {
    return 'That credential was already used — refresh your credit credential and try again.';
  }
  if (/Active loan exists/i.test(raw)) {
    return 'Repay your active loan first, then borrow again.';
  }
  if (/Ineligible tier/i.test(raw)) {
    return 'The contract does not accept this tier. Re-issue your credential.';
  }
  if (/insufficient liquidity/i.test(raw)) {
    return 'The pool does not have enough liquidity for this loan. Ask the deployer to fund the pool.';
  }
  if (/Nothing to claim/i.test(raw)) {
    return 'No accrued interest to claim yet — interest becomes claimable after pool loans are repaid.';
  }
  if (/Zero deposit/i.test(raw)) {
    return 'Deposit amount must be greater than zero.';
  }
  if (/wrong network|unsupported network|network does not match|chainId.*mismatch/i.test(raw)) {
    return 'Please connect MetaMask to the local Hardhat network (0x7a69).';
  }
  const short = raw.replace(/\s+/g, ' ').trim().slice(0, 140);
  return `${short}`;
}

const ShieldIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const CheckIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const WalletIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <rect x="1" y="2" width="22" height="16" rx="2" ry="2"/>
    <line x1="12" y1="14" x2="12.01" y2="14"/>
    <path d="M16 2v11c0 2.8-1.5 4.4-3.5 5.7C9.5 16.4 8 14.8 8 12V2z"/>
  </svg>
);
const TrendingUpIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
    <polyline points="17 6 23 6 23 12"/>
  </svg>
);
const LockIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);
const PercentIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M5 5l14 14M5 19l14-14"/>
  </svg>
);
const CoinsIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <circle cx="12" cy="5" r="2"/>
    <circle cx="6" cy="12" r="2"/>
    <circle cx="18" cy="12" r="2"/>
    <circle cx="12" cy="19" r="2"/>
  </svg>
);
const ClockIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);
const SendIcon = ({ className = 'w-5 h-5', 'aria-hidden': ariaHidden = 'true' } = {}) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={ariaHidden}>
    <line x1="19" y1="14" x2="2" y2="7"/>
    <path d="M22 19v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2z"/>
  </svg>
);

const Skeleton = ({ className = '' }) => (
  <div className={`skeleton-shimmer animate-pulse h-6 rounded ${className}`} />
);

const AnimatedCounter = ({ value, label, icon: Icon, color = 'text-white', prefix = '', suffix = ' ETH', className = '' }) => {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => {
    const start = 0;
    const end = parseFloat(value) || 0;
    const duration = 1200;
    const startTime = performance.now();
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue((start + eased * (end - start)).toFixed(2));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return (
    <div className={`card-lift card animate-fade-in animate-slide-up ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
        {Icon && <Icon className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`counter-value text-xl font-mono font-bold ${color} animate-count-up`}>{prefix}{displayValue}</span>
        <span className="text-sm text-[var(--color-muted-strong)]">{suffix}</span>
      </div>
    </div>
  );
};

const Sparkline = ({ points, color = 'var(--color-primary)' }) => {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = 100 - ((p - min) / range) * 100;
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  return (
    <svg className="w-full h-24" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path className="sparkline-path" d={path} stroke={color} aria-hidden="true" />
    </svg>
  );
};

const RecentActivity = ({ items }) => {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
        <SendIcon className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
        Recent Activity
      </h3>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--color-surface-elevated-dark)] border border-[var(--color-hairline-dark)] animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
            <div className="w-2 h-2 rounded-full bg-[var(--color-trading-up)] animate-pulse-slow" aria-hidden="true" />
            <span className="text-xs text-[var(--color-body-dark)] truncate">{item.address}</span>
            <span className="text-xs text-[var(--color-trading-up)]">+{item.amount} ETH</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  const [credential, setCredential] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txState, setTxState] = useState({ status: 'idle', hash: null, message: null });
  const [loanState, setLoanState] = useState(null);
  const [poolLiquidity, setPoolLiquidity] = useState('0');
  const [poolTotalDeposits, setPoolTotalDeposits] = useState('0');
  const [poolTotalInterestEarned, setPoolTotalInterestEarned] = useState('0');
  const [contractError, setContractError] = useState(null);
  const [tierTerms, setTierTerms] = useState(null);
  const [faucetState, setFaucetState] = useState({ status: 'idle', message: null });
  const [earnedYield, setEarnedYield] = useState(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositBusy, setDepositBusy] = useState(false);
  const [toastTimer, setToastTimer] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const { account, error: walletError, connectWallet, disconnectWallet, switchToLocalNetwork, shortenedAddress, hasMetaMask, isLocalNetwork } = useWallet();

  const getContract = useCallback(async (provider) => {
    return new Contract(CONTRACT_ADDRESS, ABI, provider);
  }, []);

  const refreshOnChainData = useCallback(async () => {
    if (!window.ethereum || !account) return;
    try {
      setDataLoading(true);
      const provider = new BrowserProvider(window.ethereum);
      const contract = await getContract(provider);
      const liquidity = await contract.getLiquidity();
      const [earned, totalDeposits, totalInterestEarned] = await Promise.all([
        contract.earned(account),
        contract.totalDeposits(),
        contract.totalInterestEarned(),
      ]);
      setPoolLiquidity(formatEther(liquidity));
      setPoolTotalDeposits(formatEther(totalDeposits));
      setPoolTotalInterestEarned(formatEther(totalInterestEarned));
      setEarnedYield(formatEther(earned));
      const loan = await contract.getLoan(account);
      setLoanState({
        borrower: loan.borrowerAddr,
        principal: formatEther(loan.principal),
        repaymentDue: formatEther(loan.repaymentDueVal),
        tier: loan.tierVal,
        repaid: loan.repaidVal,
      });
      setContractError(null);
    } catch (e) {
      const raw = String((e && (e.message || e.reason)) || e || '');
      if (/missing revert data|CALL_EXCEPTION/i.test(raw)) {
        setContractError('Failed to read contract state — ensure MetaMask is on local Hardhat (31337) and servers are running; try refreshing.');
      } else {
        setContractError('Failed to read contract: ' + raw);
      }
      console.error('refreshOnChainData error', e);
    } finally {
      setDataLoading(false);
    }
  }, [account, getContract]);

  useEffect(() => {
    if (isLocalNetwork && account) {
      refreshOnChainData();
      const interval = setInterval(refreshOnChainData, 8000);
      return () => clearInterval(interval);
    }
  }, [isLocalNetwork, account, refreshOnChainData]);

  useEffect(() => {
    const tier = credential && credential.credential ? credential.credential.tier : null;
    if (!tier) { setTierTerms(null); return; }
    let cancelled = false;
    (async () => {
      if (!window.ethereum) return;
      try {
        const provider = new BrowserProvider(window.ethereum);
        const contract = await getContract(provider);
        const [limit, rate] = await Promise.all([contract.tierLimits(tier), contract.tierRates(tier)]);
        if (!cancelled && limit > 0n) {
          setTierTerms({ maxETH: formatEther(limit), ratePercent: (Number(rate) / 100), onChain: true });
        }
      } catch (e) { /* keep fallback */ }
    })();
    return () => { cancelled = true; };
  }, [credential, getContract]);

  const handleLaunch = async () => {
    setLoading(true); setCredential(null); setBackendError(null);
    try {
      const res = await fetch('/api/credentials/issue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account || '' })
      });
      const data = await res.json();
      if (!res.ok || data.error) { setBackendError(data.error || `Request failed: ${res.status}`); setCredential(null); }
      else { setCredential(data); setBackendError(null); }
    } catch (e) { setBackendError('Failed to connect to backend: ' + (e.message || e)); setCredential(null); }
    setLoading(false);
  };

  const handleFaucet = async () => {
    if (!account) return;
    setFaucetState({ status: 'pending', message: 'Requesting 0.5 test ETH from the local faucet…' });
    try {
      const res = await fetch('/api/faucet/drip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account })
      });
      const data = await res.json();
      if (res.ok) { setFaucetState({ status: 'done', message: `${data.amount} ETH sent — new balance: ${data.balanceETH} ETH` }); }
      else { setFaucetState({ status: 'failed', message: data.error || `Faucet failed: ${res.status}` }); }
    } catch (e) { setFaucetState({ status: 'failed', message: 'Faucet unreachable: ' + (e.message || e) }); }
  };

  const handleBorrow = async () => {
    if (!credential || !credential.credential || !credential.signature || !credential.tierHash) {
      setTxState({ status: 'failed', message: 'No valid credential available', hash: null }); return;
    }
    if (!isLocalNetwork) { setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null }); return; }
    if (loanState && loanState.borrower && loanState.borrower !== '0x0000000000000000000000000000000000000000' && !loanState.repaid) {
      setTxState({ status: 'failed', message: 'You already have an active loan. Repay it first, then borrow again — possibly with an upgraded tier.', hash: null }); return;
    }
    if (credential.credential.userAddress !== account) { setTxState({ status: 'failed', message: 'Credential wallet does not match connected account', hash: null }); return; }
    if (typeof credential.credential.issuedAt !== 'number') { setTxState({ status: 'failed', message: 'Stale credential missing issuedAt — refresh your credit credential', hash: null }); return; }
    setTxState({ status: 'submitting', message: 'Submitting borrow transaction…', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.verifyAndIssueLoan(credential.credential.tier, credential.credential.userAddress, credential.credential.issuedAt, credential.tierHash, credential.signature);
      setTxState({ status: 'pending', message: 'Transaction pending…', hash: tx.hash });
      const receipt = await tx.wait();
      if (receipt.status === 1) { setTxState({ status: 'confirmed', message: 'Loan issued successfully', hash: tx.hash }); await refreshOnChainData(); }
      else { setTxState({ status: 'failed', message: 'Transaction failed', hash: tx.hash }); }
    } catch (e) { setTxState({ status: 'failed', message: 'Borrow failed: ' + friendlyTxError(e), hash: null }); }
  };

  const handleRepay = async () => {
    if (!loanState || !loanState.borrower || loanState.borrower === '0x0000000000000000000000000000000000000000' || loanState.repaid) {
      setTxState({ status: 'failed', message: 'No active loan to repay', hash: null }); return;
    }
    if (!credential || !credential.tierHash) { setTxState({ status: 'failed', message: 'No credential available for repayment', hash: null }); return; }
    if (!isLocalNetwork) { setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null }); return; }
    setTxState({ status: 'submitting', message: 'Submitting repayment…', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const loanRow = await contract.loans(account);
      const repaymentDue = loanRow.repaymentDue;
      const tierHash = loanRow.tierHash;
      if (!tierHash) { setTxState({ status: 'failed', message: 'Active loan has no issuing credential hash', hash: null }); return; }
      const tx = await contract.repay(tierHash, { value: repaymentDue });
      setTxState({ status: 'pending', message: 'Repayment pending…', hash: tx.hash });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        let repayMsg = 'Loan repaid successfully';
        let upgraded = false;
        try {
          const recRes = await fetch('/api/repayments/record', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userAddress: account, txHash: tx.hash })
          });
          const recData = await recRes.json();
          if (recRes.ok && recData.recorded && recData.evaluation) {
            upgraded = true;
            const nextTier = recData.evaluation.tier;
            const prevTier = credential && credential.credential ? credential.credential.tier : null;
            if (prevTier && nextTier !== prevTier) {
              repayMsg = `Loan repaid successfully. Credit updated — your tier is now ${nextTier}.`;
            } else {
              const count = recData.evaluation.repaymentRecords || 0;
              repayMsg = `Loan repaid successfully. ${count} repayment${count === 1 ? '' : 's'} on record ($${Math.round(recData.evaluation.totalPaidUSD)} total).`;
            }
          } else if (recRes.ok && recData.alreadyRecorded) { repayMsg = 'Loan repaid successfully. Repayment was already recorded.'; }
          else if (!recRes.ok && recData && recData.error) { repayMsg = `Loan repaid successfully (credit update pending: ${recData.error})`; }
        } catch (e) { repayMsg = 'Loan repaid successfully (credit update pending)'; }
        setTxState({ status: 'confirmed', message: repayMsg, hash: tx.hash });
        await refreshOnChainData();
        if (upgraded) { await handleLaunch(); }
      } else { setTxState({ status: 'failed', message: 'Repayment transaction failed', hash: tx.hash }); }
    } catch (e) { setTxState({ status: 'failed', message: 'Repayment failed: ' + friendlyTxError(e), hash: null }); }
  };

  const handleClaim = async () => {
    if (!account || !window.ethereum || claimBusy) return;
    if (!isLocalNetwork) { setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null }); return; }
    setClaimBusy(true);
    setTxState({ status: 'submitting', message: 'Submitting interest claim…', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.claim();
      setTxState({ status: 'pending', message: 'Interest claim pending…', hash: tx.hash });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        const amount = earnedYield !== null ? earnedYield : '0';
        setTxState({ status: 'confirmed', message: `Interest claim confirmed — ${amount} ETH accrued yield withdrawn`, hash: tx.hash });
        await refreshOnChainData();
      } else { setTxState({ status: 'failed', message: 'Interest claim transaction failed', hash: tx.hash }); }
    } catch (e) { setTxState({ status: 'failed', message: 'Interest claim failed: ' + friendlyTxError(e), hash: null }); }
    setClaimBusy(false);
  };

  const handleDeposit = async () => {
    if (!account || !window.ethereum || depositBusy) return;
    if (!isLocalNetwork) { setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null }); return; }
    let amount;
    try { amount = parseEther(depositAmount); } catch (e) { setTxState({ status: 'failed', message: 'Deposit amount must be a valid ETH value (e.g. 0.1)', hash: null }); return; }
    if (amount <= 0n) { setTxState({ status: 'failed', message: 'Deposit amount must be greater than zero', hash: null }); return; }
    setDepositBusy(true);
    setTxState({ status: 'submitting', message: `Submitting deposit of ${depositAmount} ETH…`, hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.deposit({ value: amount });
      setTxState({ status: 'pending', message: 'Deposit pending…', hash: tx.hash });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        setTxState({ status: 'confirmed', message: `Deposit confirmed — ${depositAmount} ETH added to your pool share; you now accrue interest on repayments.`, hash: tx.hash });
        setDepositAmount(''); await refreshOnChainData();
      } else { setTxState({ status: 'failed', message: 'Deposit transaction failed', hash: tx.hash }); }
    } catch (e) { setTxState({ status: 'failed', message: 'Deposit failed: ' + friendlyTxError(e), hash: null }); }
    setDepositBusy(false);
  };

  const tierInfo = (credential && credential.credential)
    ? (tierTerms || FALLBACK_TIER_MAP[credential.credential.tier] || null)
    : null;
  const tierTermsOnChain = !!tierTerms?.onChain;

  const hasActiveLoan = loanState && loanState.borrower && loanState.borrower !== '0x0000000000000000000000000000000000000000' && !loanState.repaid;
  const busy = txState.status === 'pending' || txState.status === 'submitting';

  return (
    <main className="min-h-screen bg-[var(--color-canvas-dark)] text-[var(--color-body-dark)] selection:bg-[var(--color-primary)] selection:text-[var(--color-ink)] relative">
      {/* Decorative background orbs — subtle */}
      <div className="bg-orb bg-orb-pink" />
      <div className="bg-orb bg-orb-yellow" />
      <div className="bg-orb bg-orb-blue" />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-[var(--color-hairline-dark)] bg-[var(--color-canvas-dark)]/80 backdrop-blur-md">
        <div className="container flex items-center justify-between h-full">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-7 h-7 fill-[var(--color-primary)]" />
            <span className="text-lg font-bold text-[var(--color-primary)] tracking-tight">CredPass</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium hidden md:flex">
            <a href="#features" className="text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-md px-2">Features</a>
            <a href="#how-it-works" className="text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-md px-2">How It Works</a>
          </div>
          <div className="flex items-center gap-3 ml-4">
            {account ? (
              <>
                <span className="text-xs font-medium text-[var(--color-body-dark)] bg-[var(--color-surface-card-dark)] px-2.5 py-1 rounded-full border border-[var(--color-hairline-dark)]">{shortenedAddress}</span>
                <span className="text-xs text-[var(--color-muted-strong)] flex items-center gap-1.5">
                  {isLocalNetwork ? (
                    <>
                      <span className="status-dot w-1.5 h-1.5 rounded-full bg-[var(--color-trading-up)]" aria-hidden="true" />
                      Local
                    </>
                  ) : (
                    'Wrong Network'
                  )}
                </span>
                {account && isLocalNetwork && (
                  <button
                    onClick={handleFaucet}
                    disabled={faucetState.status === 'pending' || faucetState.status === 'done'}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--color-surface-card-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-elevated-dark)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {faucetState.status === 'pending' ? 'Dripping…' : faucetState.status === 'done' ? 'Faucet Sent' : 'Get test ETH'}
                  </button>
                )}
                <button onClick={disconnectWallet} className="text-xs font-medium text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors">Disconnect</button>
              </>
            ) : (
              <button onClick={connectWallet} disabled={!hasMetaMask} className="btn-primary text-sm px-4 py-2" aria-label="Connect MetaMask wallet">
                {hasMetaMask ? 'Connect Wallet' : 'No Wallet'}
              </button>
            )}
            {!account && (
              <a href="#features" className="btn-secondary text-xs px-4 py-2">Get Started</a>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile menu panel */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-[var(--color-canvas-dark)]/95 backdrop-blur-sm">
          <div className="absolute top-0 right-0 p-4">
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-md text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors"
              aria-label="Close menu"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="container pt-20 pb-10">
            <nav className="space-y-6">
              <a href="#features" className="block px-6 py-3 text-[var(--color-body-dark)] rounded-xl hover:bg-[var(--color-surface-elevated-dark)] hover:text-[var(--color-primary)] transition-colors">Features</a>
              <a href="#how-it-works" className="block px-6 py-3 text-[var(--color-body-dark)] rounded-xl hover:bg-[var(--color-surface-elevated-dark)] hover:text-[var(--color-primary)] transition-colors">How It Works</a>
              {account && (
                <button onClick={switchToLocalNetwork} className="w-full text-left px-6 py-3 text-sm text-[var(--color-body-dark)] rounded-xl bg-[var(--color-surface-card-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-elevated-dark)] transition-colors">Switch to Hardhat Network</button>
              )}
              {account && (
                <button onClick={disconnectWallet} className="w-full text-left px-6 py-3 text-sm text-[var(--color-trading-down)] rounded-xl bg-[var(--color-surface-card-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-trading-down)]/10 transition-colors">Disconnect Wallet</button>
              )}
              {!account && (
                <button onClick={connectWallet} disabled={!hasMetaMask} className="w-full text-left px-6 py-3 text-sm font-bold text-[var(--color-ink)] rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-active)] disabled:opacity-40 transition-colors">
                  {hasMetaMask ? 'Connect Wallet' : 'Install MetaMask'}
                </button>
              )}
            </nav>
          </div>
        </div>
      )}

      <div className="pt-16 pb-8">
        {faucetState.status !== 'idle' && faucetState.message && (
          <div className={`container px-0 py-3 rounded-xl border text-xs font-medium ${
            faucetState.status === 'failed'
              ? 'bg-[var(--color-trading-down)]/10 border-[var(--color-trading-down)] text-[var(--color-trading-down)]'
              : 'bg-[var(--color-trading-up)]/10 border-[var(--color-trading-up)] text-[var(--color-trading-up)]'
          }`} role="alert" aria-live="polite">
            {faucetState.message}
          </div>
        )}

        {/* Hero — always visible */}
        <section className="container px-0 pt-12 text-center animate-fade-in">
          <div className="max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-semibold mb-6">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-bounce" aria-hidden="true" />
              Privacy-First Credit Passport
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight text-wrap-balance">
              Prove Credit. <span className="text-gradient">Keep Control.</span>
            </h1>
            <p className="text-lg text-[var(--color-muted-strong)] max-w-xl mx-auto mb-10">
              CredPass is a privacy-first, wallet-linked credit passport powered by EIP-712 signed credentials.
              Prove your credit tier without exposing raw financial data on-chain.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 mb-10">
              <button onClick={handleLaunch} disabled={loading || !account} className="btn-primary text-base">
                {loading ? 'Signing…' : 'Get Credit Credential'}
              </button>
              {!account && (
                <a href="#features" className="btn-secondary text-base">
                  Explore Features
                </a>
              )}
            </div>
            {!account && (
              <div className="mt-4 animate-fade-in">
                <p className="text-sm text-[var(--color-muted-strong)] mb-3">Connect your MetaMask wallet to issue a credential.</p>
                <button onClick={connectWallet} disabled={!hasMetaMask} className="btn-primary text-base w-full sm:w-auto">
                  {hasMetaMask ? 'Connect Wallet' : 'Install MetaMask'}
                </button>
              </div>
            )}
            {walletError && (
              <p className="mt-2 text-sm text-[var(--color-trading-down)]">{walletError}</p>
            )}
            {!isLocalNetwork && account && (
              <div className="mt-4 animate-fade-in">
                <p className="text-sm text-[var(--color-trading-down)] mb-2">Connect MetaMask to local Hardhat network (0x7a69) to interact with the contract.</p>
                <button onClick={switchToLocalNetwork} className="btn-primary text-sm">
                  Switch to Hardhat Network
                </button>
              </div>
            )}
            {backendError && (
              <p className="mt-2 text-sm text-[var(--color-trading-down)]">{backendError}</p>
            )}
          </div>
        </section>

        {/* Features grid */}
        <section className="mt-16 px-0 pt-12 border-t border-[var(--color-hairline-dark)]">
          <div className="container">
            <div className="grid sm:grid-cols-3 gap-5">
              <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '100ms' }}>
                <ShieldIcon className="w-5 h-5 text-[var(--color-primary)] mb-3" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white mb-2">Privacy-First</h3>
                <p className="text-[12px] text-[var(--color-muted-strong)] leading-relaxed">
                  EIP-712 signed credentials prove your tier without exposing raw financial data.
                </p>
              </div>
              <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '200ms' }}>
                <TrendingUpIcon className="w-5 h-5 text-[var(--color-primary)] mb-3" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white mb-2">Undercollateralized</h3>
                <p className="text-[12px] text-[var(--color-muted-strong)] leading-relaxed">
                  Smart contracts verify your credential and unlock undercollateralized loan terms.
                </p>
              </div>
              <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '300ms' }}>
                <WalletIcon className="w-5 h-5 text-[var(--color-primary)] mb-3" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white mb-2">Wallet-Linked</h3>
                <p className="text-[12px] text-[var(--color-muted-strong)] leading-relaxed">
                  Your credit reputation travels with your MetaMask wallet. Portable and verifiable.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Pool & Loan State — always visible */}
      <section className="container px-0 pt-8 pb-16">
        <h2 className="text-xl font-bold text-white mb-6">Pool & Loan State (On-Chain)</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          <AnimatedCounter
            value={dataLoading ? '0' : poolLiquidity}
            label="Pool Liquidity"
            icon={CoinsIcon}
            color="text-white"
            suffix=" ETH"
            className="stagger-1"
          />
          <AnimatedCounter
            value={dataLoading ? '0' : (earnedYield !== null ? earnedYield : '0')}
            label="Your Accrued Yield"
            icon={SendIcon}
            color="text-[var(--color-primary)]"
            suffix=" ETH"
            className="stagger-2"
          />
          <AnimatedCounter
            value={dataLoading ? '0' : poolTotalDeposits}
            label="Total Deposits"
            icon={WalletIcon}
            color="text-white"
            suffix=" ETH"
            className="stagger-3"
          />
          <AnimatedCounter
            value={dataLoading ? '0' : poolTotalInterestEarned}
            label="Total Interest Paid"
            icon={TrendingUpIcon}
            color="text-[var(--color-trading-up)]"
            suffix=" ETH"
            className="stagger-4"
          />
        </div>

        {/* Your Position */}
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-base font-bold text-white">Your Position</h3>
              <p className="text-[11px] text-[var(--color-muted-strong)]">Borrower state on the lending pool contract.</p>
            </div>
            <CoinsIcon className="w-6 h-6 text-[var(--color-muted-strong)]" aria-hidden="true" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
              <div className="flex items-center gap-2">
                <LockIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                <span className="text-sm text-[var(--color-body-dark)]">Borrower</span>
              </div>
              <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.borrower ? loanState.borrower : 'None'}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
              <div className="flex items-center gap-2">
                <PercentIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                <span className="text-sm text-[var(--color-body-dark)]">Principal</span>
              </div>
              <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.principal ? loanState.principal + ' ETH' : '—'}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
              <div className="flex items-center gap-2">
                <ClockIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                <span className="text-sm text-[var(--color-body-dark)]">Repayment Due</span>
              </div>
              <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.repaymentDue ? loanState.repaymentDue + ' ETH' : '—'}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
              <div className="flex items-center gap-2">
                <ShieldIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                <span className="text-sm text-[var(--color-body-dark)]">Tier</span>
              </div>
              <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.tier ? loanState.tier : '—'}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
              <div className="flex items-center gap-2">
                <CheckIcon className="w-3 h-3 text-[var(--color-trading-up)]" aria-hidden="true" />
                <span className="text-sm text-[var(--color-body-dark)]">Repaid</span>
              </div>
              <span className={`font-mono text-[11px] ${loanState?.repaid ? 'text-[var(--color-trading-up)]' : 'text-[var(--color-muted)]'}`}>
                {loanState ? (loanState.repaid ? 'Yes' : 'No') : '—'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Sparkline + Recent Activity */}
      {account && (
        <section className="container px-0 pt-8 pb-16">
          <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '400ms' }}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-6 mb-4">
              <div className="flex-1">
                <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                  <TrendingUpIcon className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
                  Pool Activity
                </h3>
                <div className="h-32 w-full">
                  <Sparkline points={[45, 62, 38, 78, 55, 90, 68, 110, 85, 140, 95, 130, 115, 160]} />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                  <SendIcon className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
                  Recent Activity
                </h3>
                <RecentActivity items={[
                  { address: '0x7099…79C8', amount: '5.00' },
                  { address: '0x3C44…DdDd', amount: '0.20' },
                  { address: '0xd67e…d528', amount: '0.10' },
                  { address: '0x19E7…ff2A', amount: '2.50' },
                  { address: '0x7099…79C8', amount: '5.175' },
                ]} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Deposit & Claim — account only */}
      {account && (
        <section className="container px-0 pt-8 pb-16">
          <div className="card">
            <div className="grid sm:grid-cols-2 gap-5">
              <div className="card">
                <h4 className="text-xs font-bold text-white mb-4 flex items-center gap-2">
                  <SendIcon className="w-3 h-3 text-[var(--color-primary)]" aria-hidden="true" />
                  Deposit into Pool
                </h4>
                <p className="text-[11px] text-[var(--color-muted-strong)] mb-4">Deposit ETH into the lending pool — you accrue a proportional share of repayment interest.</p>
                <div className="input-focus flex gap-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.1"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    disabled={!account || depositBusy}
                    className="input-field"
                    aria-label="Deposit amount in ETH"
                  />
                  <button
                    onClick={handleDeposit}
                    disabled={!account || depositBusy || !depositAmount || parseFloat(depositAmount) <= 0 || isNaN(parseFloat(depositAmount))}
                    className="btn-primary text-sm"
                  >
                    {depositBusy ? 'Depositing…' : 'Deposit'}
                  </button>
                </div>
              </div>
              <div className="card">
                <h4 className="text-xs font-bold text-white mb-4 flex items-center gap-2">
                  <CheckIcon className="w-3 h-3 text-[var(--color-primary)]" aria-hidden="true" />
                  Claim Interest
                </h4>
                <p className="text-[11px] text-[var(--color-muted-strong)] mb-4">Withdraw your accrued-but-unclaimed interest from the pool.</p>
                <button
                  onClick={handleClaim}
                  disabled={!account || claimBusy || !earnedYield || parseFloat(earnedYield) <= 0}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
                    earnedYield !== null && parseFloat(earnedYield) > 0
                      ? 'bg-[var(--color-primary)] text-[var(--color-ink)] hover:bg-[var(--color-primary-active)]'
                      : 'bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)]'
                  }`}
                >
                  {claimBusy ? 'Claiming…' : earnedYield !== null && parseFloat(earnedYield) > 0 ? 'Claim Interest' : 'No Yield to Claim'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Logged-in features */}
      {account && (
        <section className="container px-0 pt-12 pb-16 border-t border-[var(--color-hairline-dark)]">
          <div className="container">
            {/* Features grid */}
            <div className="grid sm:grid-cols-3 gap-5 mb-16">
              <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '100ms' }}>
                <ShieldIcon className="w-5 h-5 text-[var(--color-primary)] mb-3" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white mb-2">Privacy-First</h3>
                <p className="text-[12px] text-[var(--color-muted-strong)] leading-relaxed">
                  EIP-712 signed credentials prove your tier without exposing raw financial data.
                </p>
              </div>
              <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '200ms' }}>
                <TrendingUpIcon className="w-5 h-5 text-[var(--color-primary)] mb-3" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white mb-2">Undercollateralized</h3>
                <p className="text-[12px] text-[var(--color-muted-strong)] leading-relaxed">
                  Smart contracts verify your credential and unlock undercollateralized loan terms.
                </p>
              </div>
              <div className="card-lift card animate-fade-in animate-slide-up" style={{ animationDelay: '300ms' }}>
                <WalletIcon className="w-5 h-5 text-[var(--color-primary)] mb-3" aria-hidden="true" />
                <h3 className="text-sm font-bold text-white mb-2">Wallet-Linked</h3>
                <p className="text-[12px] text-[var(--color-muted-strong)] leading-relaxed">
                  Your credit reputation travels with your MetaMask wallet. Portable and verifiable.
                </p>
              </div>
            </div>

            {/* Pool stats */}
            <h2 className="text-xl font-bold text-white mb-6">Pool & Loan State</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              <AnimatedCounter
                value={dataLoading ? '0' : poolLiquidity}
                label="Pool Liquidity"
                icon={CoinsIcon}
                color="text-white"
                suffix=" ETH"
                className="stagger-1"
              />
              <AnimatedCounter
                value={dataLoading ? '0' : (earnedYield !== null ? earnedYield : '0')}
                label="Your Accrued Yield"
                icon={SendIcon}
                color="text-[var(--color-primary)]"
                suffix=" ETH"
                className="stagger-2"
              />
              <AnimatedCounter
                value={dataLoading ? '0' : poolTotalDeposits}
                label="Total Deposits"
                icon={WalletIcon}
                color="text-white"
                suffix=" ETH"
                className="stagger-3"
              />
              <AnimatedCounter
                value={dataLoading ? '0' : poolTotalInterestEarned}
                label="Total Interest Paid"
                icon={TrendingUpIcon}
                color="text-[var(--color-trading-up)]"
                suffix=" ETH"
                className="stagger-4"
              />
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Your Position */}
              <div className="col-span-1 lg:col-span-2">
                <div className="card">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h3 className="text-base font-bold text-white">Your Position</h3>
                      <p className="text-[11px] text-[var(--color-muted-strong)]">Borrower state on the lending pool contract.</p>
                    </div>
                    <CoinsIcon className="w-6 h-6 text-[var(--color-muted-strong)]" aria-hidden="true" />
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                      <div className="flex items-center gap-2">
                        <LockIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                        <span className="text-sm text-[var(--color-body-dark)]">Borrower</span>
                      </div>
                      <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.borrower ? loanState.borrower : 'None'}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                      <div className="flex items-center gap-2">
                        <PercentIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                        <span className="text-sm text-[var(--color-body-dark)]">Principal</span>
                      </div>
                      <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.principal ? loanState.principal + ' ETH' : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                      <div className="flex items-center gap-2">
                        <ClockIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                        <span className="text-sm text-[var(--color-body-dark)]">Repayment Due</span>
                      </div>
                      <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.repaymentDue ? loanState.repaymentDue + ' ETH' : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                      <div className="flex items-center gap-2">
                        <ShieldIcon className="w-3 h-3 text-[var(--color-muted-strong)]" aria-hidden="true" />
                        <span className="text-sm text-[var(--color-body-dark)]">Tier</span>
                      </div>
                      <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{loanState && loanState.tier ? loanState.tier : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                      <div className="flex items-center gap-2">
                        <CheckIcon className="w-3 h-3 text-[var(--color-trading-up)]" aria-hidden="true" />
                        <span className="text-sm text-[var(--color-body-dark)]">Repaid</span>
                      </div>
                      <span className={`font-mono text-[11px] ${loanState?.repaid ? 'text-[var(--color-trading-up)]' : 'text-[var(--color-muted)]'}`}>
                        {loanState ? (loanState.repaid ? 'Yes' : 'No') : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Borrow / Repay actions */}
                <div className="mt-8 card">
                  <h3 className="text-base font-bold text-white mb-4">Loan Terms (From Contract)</h3>
                  <div className="grid sm:grid-cols-3 gap-4 mb-6">
                    <div className="bg-[var(--color-surface-elevated-dark)] rounded-xl p-4 border border-[var(--color-hairline-dark)]">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1">Tier</div>
                      <div className="text-xl font-bold text-[var(--color-primary)]">{credential?.credential?.tier}</div>
                    </div>
                    <div className="bg-[var(--color-surface-elevated-dark)] rounded-xl p-4 border border-[var(--color-hairline-dark)]">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1">Max Loan</div>
                      <div className="text-xl font-bold text-white">{tierInfo?.maxETH} ETH</div>
                    </div>
                    <div className="bg-[var(--color-surface-elevated-dark)] rounded-xl p-4 border border-[var(--color-hairline-dark)]">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1">Fixed Rate</div>
                      <div className="text-xl font-bold text-white">{tierInfo?.ratePercent}%</div>
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-elevated-dark)] rounded-xl p-4 border border-[var(--color-hairline-dark)]">
                    <div className="flex justify-between mb-2"><span className="text-[var(--color-muted-strong)]">Principal</span> <span className="font-mono text-[var(--color-body-dark)]">{tierInfo?.maxETH} ETH</span></div>
                    <div className="flex justify-between mb-2"><span className="text-[var(--color-muted-strong)]">Fixed Interest</span> <span className="font-mono text-[var(--color-body-dark)]">{parseFloat(tierInfo?.maxETH || '0') * parseFloat(tierInfo?.ratePercent || '0') / 100} ETH</span></div>
                    <div className="border-t border-[var(--color-hairline-dark)] pt-2 flex justify-between font-bold text-[var(--color-primary)]"><span>Total Repayment</span> <span className="font-mono">{(parseFloat(tierInfo?.maxETH || '0') * (1 + parseFloat(tierInfo?.ratePercent || '0') / 100)).toFixed(4)} ETH</span></div>
                  </div>
                  <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    <button onClick={handleBorrow} disabled={!credential || !isLocalNetwork || hasActiveLoan || busy}
                      className="btn-primary text-base">
                      {hasActiveLoan ? 'Repay Loan First' : 'Borrow ETH'}
                    </button>
                    <button onClick={handleRepay} disabled={!loanState || !loanState.borrower || loanState.borrower === '0x0000000000000000000000000000000000000000' || loanState.repaid || !isLocalNetwork || busy} className="btn-secondary text-base">
                      Repay Loan
                    </button>
                  </div>
                </div>

                {/* Deposit & Claim */}
                <div className="mt-8 card">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div className="card">
                      <h4 className="text-xs font-bold text-white mb-4 flex items-center gap-2">
                        <SendIcon className="w-3 h-3 text-[var(--color-primary)]" aria-hidden="true" />
                        Deposit into Pool
                      </h4>
                      <p className="text-[11px] text-[var(--color-muted-strong)] mb-4">Deposit ETH into the lending pool — you accrue a proportional share of repayment interest.</p>
                      <div className="input-focus flex gap-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.1"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                          disabled={!account || depositBusy}
                          className="input-field"
                          aria-label="Deposit amount in ETH"
                        />
                        <button
                          onClick={handleDeposit}
                          disabled={!account || depositBusy || !depositAmount || parseFloat(depositAmount) <= 0 || isNaN(parseFloat(depositAmount))}
                          className="btn-primary text-sm"
                        >
                          {depositBusy ? 'Depositing…' : 'Deposit'}
                        </button>
                      </div>
                    </div>
                    <div className="card">
                      <h4 className="text-xs font-bold text-white mb-4 flex items-center gap-2">
                        <CheckIcon className="w-3 h-3 text-[var(--color-primary)]" aria-hidden="true" />
                        Claim Interest
                      </h4>
                      <p className="text-[11px] text-[var(--color-muted-strong)] mb-4">Withdraw your accrued-but-unclaimed interest from the pool.</p>
                      <button
                        onClick={handleClaim}
                        disabled={!account || claimBusy || !earnedYield || parseFloat(earnedYield) <= 0}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
                          earnedYield !== null && parseFloat(earnedYield) > 0
                            ? 'bg-[var(--color-primary)] text-[var(--color-ink)] hover:bg-[var(--color-primary-active)]'
                            : 'bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)]'
                        }`}
                      >
                        {claimBusy ? 'Claiming…' : earnedYield !== null && parseFloat(earnedYield) > 0 ? 'Claim Interest' : 'No Yield to Claim'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right sidebar */}
              <div className="col-span-1 lg:col-span-1">
                <div className="card h-full">
                  <div className="flex flex-col gap-6">
                    <div>
                      <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                        <SendIcon className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
                        Recent Activity
                      </h3>
                      <RecentActivity items={[
                        { address: '0x7099…79C8', amount: '5.00' },
                        { address: '0x3C44…DdDd', amount: '0.20' },
                        { address: '0xd67e…d528', amount: '0.10' },
                        { address: '0x19E7…ff2A', amount: '2.50' },
                        { address: '0x7099…79C8', amount: '5.175' },
                      ]} />
                    </div>
                    <div className="mt-8">
                      <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                        <TrendingUpIcon className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
                        Pool Activity
                      </h3>
                      <div className="h-32 w-full">
                        <Sparkline points={[45, 62, 38, 78, 55, 90, 68, 110, 85, 140, 95, 130, 115, 160]} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Credential Card (logged in + credential issued) */}
      {account && credential && (
        <section className="container px-0 pt-8 pb-16">
          <div className="card max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)] text-[var(--color-ink)] flex items-center justify-center font-bold text-xl">
                  {credential.credential?.tier}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Credit Credential Issued</h3>
                  <p className="text-xs text-[var(--color-muted-strong)]">EIP-712 signed · Tier {credential.credential?.tier}</p>
                </div>
              </div>
              <ClockIcon className="w-5 h-5 text-[var(--color-muted-strong)]" aria-hidden="true" />
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                <span className="text-[var(--color-muted)]">Tier</span>
                <span className="font-mono font-bold text-[var(--color-primary)]">{credential.credential?.tier || 'Unknown'}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                <span className="text-[var(--color-muted)]">Wallet</span>
                <span className="font-mono text-[11px] text-[var(--color-body-dark)] truncate">{credential.credential?.userAddress}</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                <span className="text-[var(--color-muted)]">Tier Hash</span>
                <span className="font-mono text-[11px] text-[var(--color-muted)] truncate">{credential.tierHash}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Evaluation</span>
                <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{credential.evaluation?.tier || '—'} tier · ${credential.evaluation?.totalPaidUSD || 0}</span>
              </div>
              {typeof credential.credential?.issuedAt === 'number' && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Issued</span>
                  <span className="font-mono text-[11px] text-[var(--color-body-dark)]">{new Date(credential.credential.issuedAt * 1000).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
            <p className="mt-4 text-[11px] text-[var(--color-muted-strong)]">Signature and tier are authoritative from backend. Client does not control tier.</p>
          </div>
        </section>
      )}

      {/* Credential Progress */}
      {account && credential?.progress?.nextTier && (
        <section className="container px-0 pt-8 pb-16">
          <div className="card max-w-3xl mx-auto">
            <h3 className="text-[var(--color-primary)] font-bold text-sm mb-4">Progress toward Tier {credential.progress.nextTier}</h3>
            <ul className="space-y-3">
              {credential.progress.requirements.map((r, i) => {
                const pct = Math.min(100, Math.round(((Number(r.have) || 0) / r.need) * 100));
                return (
                  <li key={i} className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <span className="text-sm">{r.met ? '✓' : '○'} {r.label}</span>
                      <span className="font-mono text-[11px] text-[var(--color-muted)]">{r.unit}{r.have} / {r.unit}{r.need}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--color-surface-elevated-dark)] overflow-hidden">
                      <div className={"h-full rounded-full transition-all duration-700 " + (r.met ? 'bg-[var(--color-trading-up)]' : 'bg-[var(--color-primary)]')} style={{ width: pct + '%' }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] text-[var(--color-muted-strong)]">Repay loans on-chain to lift your tier — tiers only improve with verified repayments.</p>
          </div>
        </section>
      )}

      {/* Transaction Toast */}
      {txState.status !== 'idle' && (
        <section className="fixed top-20 right-6 z-50 w-full max-w-sm pointer-events-none">
          <div className={`pointer-events-auto rounded-2xl p-6 border ${
            txState.status === 'confirmed'
              ? 'bg-[var(--color-trading-up)]/10 border-[var(--color-trading-up)] shadow-[0_10px_40px_-10px_rgba(14,203,129,0.3)]'
              : txState.status === 'failed'
                ? 'bg-[var(--color-trading-down)]/10 border-[var(--color-trading-down)] shadow-[0_10px_40px_-10px_rgba(246,70,93,0.3)]'
                : 'bg-[var(--color-surface-card-dark)] border-[var(--color-hairline-dark)] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]'
          } toast-enter`} role="alert" aria-live="polite">
            <div className="flex items-center gap-3">
              {txState.status === 'confirmed' && <CheckIcon className="w-4 h-4 text-[var(--color-trading-up)]" aria-hidden="true" />}
              {txState.status === 'failed' && <LockIcon className="w-4 h-4 text-[var(--color-trading-down)]" aria-hidden="true" />}
              {(txState.status === 'submitting' || txState.status === 'pending') && <ClockIcon className="w-4 h-4 animate-pulse-slow text-[var(--color-muted-strong)]" aria-hidden="true" />}
              <div>
                <div className="font-bold text-sm">{txState.status === 'submitting' ? 'Submitting…' : txState.status === 'pending' ? 'Pending…' : txState.status === 'confirmed' ? 'Confirmed' : 'Failed'}</div>
                <div className="text-[11px] text-[var(--color-muted-strong)]">{txState.message}</div>
              </div>
              {txState.hash && (
                <div className="ml-auto text-[var(--color-muted)] text-[10px] font-mono break-all max-w-xs">
                  Tx: {txState.hash}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* How It Works */}
      <section id="how-it-works" className="container px-0 pt-16 pb-20 border-t border-[var(--color-hairline-dark)]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-white">How CredPass Works</h2>
            <a href="#features" className="text-xs text-[var(--color-primary)] font-medium hover:underline">Back to top →</a>
          </div>
          <CredentialFlow />
        </div>
      </section>

      <footer className="w-full pt-12 pb-10 border-t border-[var(--color-hairline-dark)] bg-[var(--color-surface-card-dark)]">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2">
              <ShieldIcon className="w-5 h-5 fill-[var(--color-primary)]" aria-hidden="true" />
              <span className="text-sm font-bold text-[var(--color-primary)] tracking-tight">CredPass</span>
            </div>
            <nav className="flex flex-wrap justify-center gap-6 text-xs text-[var(--color-muted)]" aria-label="Footer navigation">
              <a href="#" className="hover:text-[var(--color-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1">Privacy</a>
              <a href="#" className="hover:text-[var(--color-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1">Terms</a>
              <a href="#" className="hover:text-[var(--color-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1">GitHub</a>
              <a href="#" className="hover:text-[var(--color-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded px-1 py-1">Discord</a>
            </nav>
            <p className="text-[11px] text-[var(--color-muted)]">Privacy-first credit passport · EIP-712 credentials · Local Hardhat network</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
