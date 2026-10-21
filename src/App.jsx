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

const ShieldIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const CheckIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const WalletIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="2" width="22" height="16" rx="2" ry="2"/>
    <line x1="12" y1="14" x2="12.01" y2="14"/>
    <path d="M16 2v11c0 2.8-1.5 4.4-3.5 5.7C9.5 16.4 8 14.8 8 12V2z"/>
  </svg>
);
const TrendingUpIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
    <polyline points="17 6 23 6 23 12"/>
  </svg>
);
const LockIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);
const PercentIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M5 5l14 14M5 19l14-14"/>
  </svg>
);
const CoinsIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="2"/>
    <circle cx="6" cy="12" r="2"/>
    <circle cx="18" cy="12" r="2"/>
    <circle cx="12" cy="19" r="2"/>
  </svg>
);
const ClockIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);
const SendIcon = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="14" x2="2" y2="7"/>
    <path d="M22 19v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2z"/>
  </svg>
);

export default function App() {
  const [credential, setCredential] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txState, setTxState] = useState({ status: 'idle', hash: null, message: null });
  const [loanState, setLoanState] = useState(null);
  const [poolLiquidity, setPoolLiquidity] = useState('0');
  const [contractError, setContractError] = useState(null);
  const [tierTerms, setTierTerms] = useState(null);
  const [faucetState, setFaucetState] = useState({ status: 'idle', message: null });
  const [earnedYield, setEarnedYield] = useState(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositBusy, setDepositBusy] = useState(false);

  const { account, error: walletError, connectWallet, disconnectWallet, switchToLocalNetwork, shortenedAddress, hasMetaMask, isLocalNetwork } = useWallet();

  const getContract = useCallback(async (provider) => {
    return new Contract(CONTRACT_ADDRESS, ABI, provider);
  }, []);

  const refreshOnChainData = useCallback(async () => {
    if (!window.ethereum || !account) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const contract = await getContract(provider);
      const liquidity = await contract.getLiquidity();
      setPoolLiquidity(formatEther(liquidity));
      const earned = await contract.earned(account);
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
    setFaucetState({ status: 'pending', message: 'Requesting 0.5 test ETH from the local faucet...' });
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
    setTxState({ status: 'submitting', message: 'Submitting borrow transaction...', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.verifyAndIssueLoan(credential.credential.tier, credential.credential.userAddress, credential.credential.issuedAt, credential.tierHash, credential.signature);
      setTxState({ status: 'pending', message: 'Transaction pending...', hash: tx.hash });
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
    setTxState({ status: 'submitting', message: 'Submitting repayment...', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const loanRow = await contract.loans(account);
      const repaymentDue = loanRow.repaymentDue;
      const tierHash = loanRow.tierHash;
      if (!tierHash) { setTxState({ status: 'failed', message: 'Active loan has no issuing credential hash', hash: null }); return; }
      const tx = await contract.repay(tierHash, { value: repaymentDue });
      setTxState({ status: 'pending', message: 'Repayment pending...', hash: tx.hash });
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
    setTxState({ status: 'submitting', message: 'Submitting interest claim...', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.claim();
      setTxState({ status: 'pending', message: 'Interest claim pending...', hash: tx.hash });
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
    setTxState({ status: 'submitting', message: `Submitting deposit of ${depositAmount} ETH...`, hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tx = await contract.deposit({ value: amount });
      setTxState({ status: 'pending', message: 'Deposit pending...', hash: tx.hash });
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
    <main className="min-h-screen bg-[var(--color-canvas-dark)] text-[var(--color-body-dark)] selection:bg-[var(--color-primary)] selection:text-[var(--color-ink)]">
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-[var(--color-hairline-dark)] bg-[var(--color-canvas-dark)]/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-6 h-full max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-7 h-7 fill-[var(--color-primary)]" />
            <span className="text-xl font-bold text-[var(--color-primary)] tracking-tight">CredPass</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium hidden md:flex">
            <a href="#features" className="text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors">Features</a>
            <a href="#how-it-works" className="text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors">How It Works</a>
          </div>
          <div className="flex items-center gap-3 ml-4">
            {account ? (
              <>
                <span className="text-xs font-medium text-[var(--color-body-dark)] bg-[var(--color-surface-card-dark)] px-3 py-1.5 rounded-full border border-[var(--color-hairline-dark)]">{shortenedAddress}</span>
                <span className="text-xs text-[var(--color-muted-strong)]">{isLocalNetwork ? 'Local' : 'Wrong Network'}</span>
                {account && isLocalNetwork && (
                  <button
                    onClick={handleFaucet}
                    disabled={faucetState.status === 'pending' || faucetState.status === 'done'}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--color-surface-card-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-elevated-dark)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {faucetState.status === 'pending' ? 'Dripping...' : faucetState.status === 'done' ? 'Faucet Sent' : 'Get test ETH'}
                  </button>
                )}
                <button onClick={disconnectWallet} className="text-xs font-medium text-[var(--color-muted-strong)] hover:text-[var(--color-primary)] transition-colors">Disconnect</button>
              </>
            ) : (
              <button onClick={connectWallet} disabled={!hasMetaMask} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--color-surface-card-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-elevated-dark)] transition-colors disabled:opacity-40">
                {hasMetaMask ? 'Connect Wallet' : 'No Wallet'}
              </button>
            )}
            {!account && (
              <a href="#features" className="px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-ink)] font-semibold text-sm hover:bg-[var(--color-primary-active)] transition-colors btn-press">Get Started</a>
            )}
          </div>
        </div>
      </nav>

      <div className="pt-16 pb-8 px-6">
        {faucetState.status !== 'idle' && faucetState.message && (
          <div className={`max-w-3xl mx-auto px-4 py-3 rounded-xl border text-xs font-medium ${
            faucetState.status === 'failed'
              ? 'bg-[var(--color-trading-down)]/10 border-[var(--color-trading-down)] text-[var(--color-trading-down)]'
              : 'bg-[var(--color-trading-up)]/10 border-[var(--color-trading-up)] text-[var(--color-trading-up)]'
          }`} role="alert">
            {faucetState.message}
          </div>
        )}

        <section id="features" className="relative px-6 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-semibold mb-8 animate-fade-in">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-bounce"></span>
              Privacy-First Credit Passport
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 animate-fade-in" style={{ animationDelay: '100ms' }}>
              Prove Credit. <span className="text-[var(--color-primary)]">Keep Control.</span>
            </h1>
            <p className="text-lg text-[var(--color-muted-strong)] max-w-2xl mx-auto mb-10 animate-fade-in" style={{ animationDelay: '200ms' }}>
              CredPass is a privacy-first, wallet-linked credit passport powered by EIP-712 signed credentials.
              Prove your credit tier without exposing raw financial data on-chain.
            </p>
            <div className="flex flex-col md:flex-row justify-center gap-4 mb-12 animate-fade-in" style={{ animationDelay: '300ms' }}>
              <button onClick={handleLaunch} disabled={loading || !account} className="px-10 py-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-primary-active)] transition-all disabled:opacity-50 disabled:cursor-not-allowed btn-press">
                {loading ? 'Signing...' : 'Get Credit Credential'}
              </button>
              {!account && (
                <a href="#how-it-works" className="px-10 py-4 rounded-xl bg-[var(--color-surface-card-dark)] text-[var(--color-body-dark)] font-bold text-lg border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-elevated-dark)] transition-all btn-press">
                  Explore Features
                </a>
              )}
            </div>
            {!account && (
              <p className="text-sm text-[var(--color-muted-strong)] animate-fade-in" style={{ animationDelay: '400ms' }}>
                Connect your MetaMask wallet to issue a credential.
              </p>
            )}
            {walletError && (
              <p className="mt-4 text-sm text-[var(--color-trading-down)] animate-fade-in">{walletError}</p>
            )}
            {!isLocalNetwork && account && (
              <div className="mt-8 animate-fade-in">
                <p className="text-sm text-[var(--color-trading-down)] mb-3">Connect to local Hardhat network (0x7a69) to interact with the contract.</p>
                <button onClick={switchToLocalNetwork} className="px-5 py-2 rounded-full bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-card-dark)] text-sm font-semibold transition-colors">
                  Switch to Hardhat Network
                </button>
              </div>
            )}
            {backendError && (
              <p className="mt-4 text-sm text-[var(--color-trading-down)] animate-fade-in">{backendError}</p>
            )}
            {credential && (
              <div className="mt-12 max-w-2xl mx-auto animate-fade-in animate-slide-up" style={{ animationDelay: '400ms' }}>
                <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-8 border border-[var(--color-hairline-dark)] text-left">
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
                    <ClockIcon className="w-6 h-6 text-[var(--color-muted-strong)]" />
                  </div>
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                      <span className="text-[var(--color-muted-strong)]">Tier</span>
                      <span className="font-mono font-bold text-[var(--color-primary)]">{credential.credential?.tier || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                      <span className="text-[var(--color-muted-strong)]">Wallet</span>
                      <span className="font-mono text-xs text-[var(--color-body-dark)] break-all">{credential.credential?.userAddress}</span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                      <span className="text-[var(--color-muted-strong)]">Tier Hash</span>
                      <span className="font-mono text-xs text-[var(--color-muted)] break-all">{credential.tierHash}</span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                      <span className="text-[var(--color-muted-strong)]">Evaluation</span>
                      <span className="font-mono text-xs text-[var(--color-body-dark)]">{credential.evaluation?.tier} tier · {credential.evaluation?.repaymentRecords || 0} records · ${credential.evaluation?.totalPaidUSD || 0}</span>
                    </div>
                    {typeof credential.credential?.issuedAt === 'number' && (
                      <div className="flex justify-between pb-2 border-b border-[var(--color-hairline-dark)]">
                        <span className="text-[var(--color-muted-strong)]">Issued</span>
                        <span className="font-mono text-xs text-[var(--color-body-dark)]">{new Date(credential.credential.issuedAt * 1000).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-xs text-[var(--color-muted-strong)]">Signature and tier are authoritative from backend. Client does not control tier.</p>
                </div>
              </div>
            )}
            {credential?.progress?.nextTier && (
              <div className="mt-8 max-w-2xl mx-auto animate-fade-in animate-slide-up" style={{ animationDelay: '500ms' }}>
                <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-8 border border-[var(--color-hairline-dark)]">
                  <h3 className="text-[var(--color-primary)] font-bold mb-4">Progress toward Tier {credential.progress.nextTier}</h3>
                  <ul className="space-y-4">
                    {credential.progress.requirements.map((r, i) => {
                      const pct = Math.min(100, Math.round(((Number(r.have) || 0) / r.need) * 100));
                      return (
                        <li key={i} className="flex flex-col gap-2">
                          <div className="flex justify-between">
                            <span className="text-sm">{r.met ? '✓' : '○'} {r.label}</span>
                            <span className="font-mono text-xs text-[var(--color-muted)]">{r.unit}{r.have} / {r.unit}{r.need}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--color-surface-elevated-dark)] overflow-hidden">
                            <div className={"h-full rounded-full transition-all duration-700 " + (r.met ? 'bg-[var(--color-trading-up)]' : 'bg-[var(--color-primary)]')} style={{ width: pct + '%' }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-4 text-xs text-[var(--color-muted-strong)]">Repay loans on-chain to lift your tier — tiers only improve with verified repayments.</p>
                </div>
              </div>
            )}
            {credential?.progress && !credential.progress.nextTier && (
              <div className="mt-8 max-w-2xl mx-auto text-sm text-[var(--color-trading-up)] animate-fade-in" style={{ animationDelay: '500ms' }}>
                ✓ Top tier unlocked — no further credit requirements.
              </div>
            )}
          </div>
        </section>
      </div>

      {credential && tierInfo && (
        <section className="px-6 pt-8 pb-16">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-white mb-6">Loan Terms (From Contract)</h2>
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-6 border border-[var(--color-hairline-dark)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-2">Tier</div>
                <div className="text-3xl font-bold text-[var(--color-primary)]">{credential.credential.tier}</div>
              </div>
              <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-6 border border-[var(--color-hairline-dark)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-2">Max Loan</div>
                <div className="text-3xl font-bold text-white">{tierInfo.maxETH} ETH</div>
                <div className="text-[10px] mt-2 text-[var(--color-muted)]">{tierTermsOnChain ? 'read from contract' : 'fallback until contract read completes'}</div>
              </div>
              <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-6 border border-[var(--color-hairline-dark)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-2">Fixed Rate</div>
                <div className="text-3xl font-bold text-white">{tierInfo.ratePercent}%</div>
                <div className="text-[10px] mt-2 text-[var(--color-muted)]">{tierTermsOnChain ? 'read from contract' : 'fallback until contract read completes'}</div>
              </div>
            </div>
            <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-8 border border-[var(--color-hairline-dark)]">
              <div className="flex justify-between mb-3"><span className="text-[var(--color-muted-strong)]">Principal</span> <span className="font-mono text-[var(--color-body-dark)]">{tierInfo.maxETH} ETH</span></div>
              <div className="flex justify-between mb-3"><span className="text-[var(--color-muted-strong)]">Fixed Interest</span> <span className="font-mono text-[var(--color-body-dark)]">{parseFloat(tierInfo.maxETH) * parseFloat(tierInfo.ratePercent) / 100} ETH</span></div>
              <div className="border-t border-[var(--color-hairline-dark)] pt-3 flex justify-between font-bold text-[var(--color-primary)]"><span>Total Repayment</span> <span className="font-mono">{(parseFloat(tierInfo.maxETH) * (1 + parseFloat(tierInfo.ratePercent) / 100)).toFixed(4)} ETH</span></div>
            </div>
            <p className="mt-4 text-xs text-[var(--color-muted-strong)]">Borrowing depends on available pool liquidity and contract validation. Maximum limits are contract-enforced.</p>
            <div className="mt-8 flex gap-4">
              <button onClick={handleBorrow} disabled={!credential || !isLocalNetwork || hasActiveLoan || busy}
                className="px-10 py-4 rounded-xl bg-[var(--color-primary)] text-[var(--color-ink)] font-bold text-lg hover:bg-[var(--color-primary-active)] transition-all disabled:opacity-50 disabled:cursor-not-allowed btn-press">
                {hasActiveLoan ? 'Repay Loan First' : 'Borrow ETH'}
              </button>
              <button onClick={handleRepay} disabled={!loanState || !loanState.borrower || loanState.borrower === '0x0000000000000000000000000000000000000000' || loanState.repaid || !isLocalNetwork || busy} className="px-10 py-4 rounded-xl bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] font-bold text-lg border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-card-dark)] transition-all disabled:opacity-40 disabled:cursor-not-allowed btn-press">
                Repay Loan
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="px-6 pt-8 pb-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-6">Pool &amp; Loan State (On-Chain)</h2>
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-7 border border-[var(--color-hairline-dark)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-3">Pool Liquidity</div>
              <div className="text-3xl font-mono font-bold text-white">{poolLiquidity} ETH</div>
            </div>
            <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-7 border border-[var(--color-hairline-dark)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-3">Your Accrued Yield</div>
              <div className="text-3xl font-mono font-bold text-[var(--color-primary)]">{earnedYield !== null ? earnedYield + ' ETH' : '—'}</div>
            </div>
            <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-7 border border-[var(--color-hairline-dark)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-3">Total Deposited</div>
              <div className="text-3xl font-mono font-bold text-white">{loanState?.principal ? loanState.principal : '0'} ETH</div>
            </div>
          </div>
          <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-8 border border-[var(--color-hairline-dark)]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-white">Your Position</h3>
                <p className="text-sm text-[var(--color-muted-strong)]">Borrower state on the lending pool contract.</p>
              </div>
              <CoinsIcon className="w-10 h-10 text-[var(--color-muted-strong)]" />
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                <div className="flex items-center gap-2">
                  <LockIcon className="w-4 h-4 text-[var(--color-muted-strong)]" />
                  <span className="text-sm text-[var(--color-body-dark)]">Borrower</span>
                </div>
                <span className="font-mono text-xs text-[var(--color-body-dark)]">{loanState && loanState.borrower ? loanState.borrower : 'None'}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                <div className="flex items-center gap-2">
                  <PercentIcon className="w-4 h-4 text-[var(--color-muted-strong)]" />
                  <span className="text-sm text-[var(--color-body-dark)]">Principal</span>
                </div>
                <span className="font-mono text-[var(--color-body-dark)]">{loanState && loanState.principal ? loanState.principal + ' ETH' : '—'}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                <div className="flex items-center gap-2">
                  <ClockIcon className="w-4 h-4 text-[var(--color-muted-strong)]" />
                  <span className="text-sm text-[var(--color-body-dark)]">Repayment Due</span>
                </div>
                <span className="font-mono text-[var(--color-body-dark)]">{loanState && loanState.repaymentDue ? loanState.repaymentDue + ' ETH' : '—'}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                <div className="flex items-center gap-2">
                  <ShieldIcon className="w-4 h-4 text-[var(--color-muted-strong)]" />
                  <span className="text-sm text-[var(--color-body-dark)]">Tier</span>
                </div>
                <span className="font-mono text-[var(--color-body-dark)]">{loanState && loanState.tier ? loanState.tier : '—'}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-[var(--color-surface-elevated-dark)] rounded-xl border border-[var(--color-hairline-dark)]">
                <div className="flex items-center gap-2">
                  <CheckIcon className="w-4 h-4 text-[var(--color-trading-up)]" />
                  <span className="text-sm text-[var(--color-body-dark)]">Repaid</span>
                </div>
                <span className={`font-mono text-xs ${loanState?.repaid ? 'text-[var(--color-trading-up)]' : 'text-[var(--color-muted)]'}`}>
                  {loanState ? (loanState.repaid ? 'Yes' : 'No') : '—'}
                </span>
              </div>
            </div>
            <div className="mt-8 grid md:grid-cols-2 gap-6">
              <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-8 border border-[var(--color-hairline-dark)]">
                <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <SendIcon className="w-4 h-4 text-[var(--color-primary)]" />
                  Deposit into Pool
                </h4>
                <p className="text-xs text-[var(--color-muted-strong)] mb-6">Deposit ETH into the lending pool — you accrue a proportional share of repayment interest.</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.1"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    disabled={!account || depositBusy}
                    className="flex-1 rounded-xl bg-[var(--color-surface-elevated-dark)] border border-[var(--color-hairline-dark)] px-4 py-3 text-sm font-mono text-[var(--color-body-dark)] focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
                  />
                  <button
                    onClick={handleDeposit}
                    disabled={!account || depositBusy || !depositAmount || parseFloat(depositAmount) <= 0 || isNaN(parseFloat(depositAmount))}
                    className="px-6 py-3 rounded-xl bg-[var(--color-primary)] text-[var(--color-ink)] font-bold text-sm hover:bg-[var(--color-primary-active)] transition-all disabled:opacity-40 disabled:cursor-not-allowed btn-press"
                  >
                    {depositBusy ? 'Depositing...' : 'Deposit'}
                  </button>
                </div>
              </div>
              <div className="bg-[var(--color-surface-card-dark)] rounded-2xl p-8 border border-[var(--color-hairline-dark)]">
                <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <CheckIcon className="w-4 h-4 text-[var(--color-primary)]" />
                  Claim Interest
                </h4>
                <p className="text-xs text-[var(--color-muted-strong)] mb-6">Withdraw your accrued-but-unclaimed interest from the pool.</p>
                <button
                  onClick={handleClaim}
                  disabled={!account || claimBusy || !earnedYield || parseFloat(earnedYield) <= 0}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed btn-press ${
                    earnedYield !== null && parseFloat(earnedYield) > 0
                      ? 'bg-[var(--color-primary)] text-[var(--color-ink)] hover:bg-[var(--color-primary-active)]'
                      : 'bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)]'
                  }`}
                >
                  {claimBusy ? 'Claiming...' : earnedYield !== null && parseFloat(earnedYield) > 0 ? 'Claim Interest' : 'No Yield to Claim'}
                </button>
              </div>
            </div>
            <p className="mt-4 text-xs text-[var(--color-muted)]">Deposit first: only pool depositors accrue repayment interest (see contracts/DEPLOY_REF.md for the proportional split details).</p>
          </div>
          {contractError && <p className="mt-4 text-sm text-[var(--color-trading-down)]">{contractError}</p>}
        </div>
      </section>

      {txState.status !== 'idle' && (
        <section className="px-6 pt-4">
          <div className={`max-w-3xl mx-auto rounded-2xl p-6 border ${
            txState.status === 'confirmed'
              ? 'bg-[var(--color-trading-up)]/10 border-[var(--color-trading-up)]'
              : txState.status === 'failed'
                ? 'bg-[var(--color-trading-down)]/10 border-[var(--color-trading-down)]'
                : 'bg-[var(--color-surface-card-dark)] border-[var(--color-hairline-dark)]'
          } toast-enter`}>
            <div className="flex items-center gap-3">
              {txState.status === 'confirmed' && <CheckIcon className="w-5 h-5 text-[var(--color-trading-up)]" />}
              {txState.status === 'failed' && <LockIcon className="w-5 h-5 text-[var(--color-trading-down)]" />}
              {(txState.status === 'submitting' || txState.status === 'pending') && <ClockIcon className="w-5 h-5 animate-pulse-slow text-[var(--color-muted-strong)]" />}
              <div>
                <div className="font-bold text-sm">{txState.status === 'submitting' ? 'Submitting...' : txState.status === 'pending' ? 'Pending...' : txState.status === 'confirmed' ? 'Confirmed' : 'Failed'}</div>
                <div className="text-xs text-[var(--color-muted-strong)]">{txState.message}</div>
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

      <section id="how-it-works" className="px-6 pt-16 pb-20 border-t border-[var(--color-hairline-dark)]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-10">
            <h2 className="text-2xl font-bold text-white">How CredPass Works</h2>
            <a href="#features" className="text-xs text-[var(--color-primary)] font-medium hover:underline">Back to top →</a>
          </div>
          <CredentialFlow />
        </div>
      </section>

      <footer className="px-6 py-12 border-t border-[var(--color-hairline-dark)] bg-[var(--color-surface-card-dark)]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-6 h-6 fill-[var(--color-primary)]" />
            <span className="text-base font-bold text-[var(--color-primary)] tracking-tight">CredPass</span>
          </div>
          <p className="text-xs text-[var(--color-muted)]">Privacy-first credit passport · EIP-712 credentials · Local Hardhat network</p>
        </div>
      </footer>
    </main>
  );
}
