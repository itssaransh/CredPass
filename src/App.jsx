import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, formatEther, parseEther } from 'ethers';
import CredentialFlow from './CredentialFlow';
import { useWallet } from './useWallet';
import abiJson from '../contracts/artifacts/contracts/CredPassLendingPool.sol/CredPassLendingPool.json';
import deployConfig from '../contracts/config/deploy-local.json';

const CONTRACT_ADDRESS = deployConfig.contractAddress;
const ABI = abiJson.abi;

// Fallback tier terms ONLY while the contract read has not resolved yet.
// The deployed contract (tierLimits/tierRates) is always the source of truth;
// these constants match its constructor values so the UI can render instantly.
const FALLBACK_TIER_MAP = {
  A: { maxETH: '5', ratePercent: '3.5' },
  B: { maxETH: '1.5', ratePercent: '8' },
  C: { maxETH: '0.2', ratePercent: '18' },
};

// Translate raw wallet/contract errors into short, actionable strings.
// Plan item 4: keep it simple — friendly message + short raw string prefix.
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

export default function App() {
  const [credential, setCredential] = useState(null);
  const [backendError, setBackendError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txState, setTxState] = useState({ status: 'idle', hash: null, message: null });
  const [loanState, setLoanState] = useState(null);
  const [poolLiquidity, setPoolLiquidity] = useState('0');
  const [contractError, setContractError] = useState(null);
  const [tierTerms, setTierTerms] = useState(null); // on-chain { maxETH, ratePercent } | null until read
  const [faucetState, setFaucetState] = useState({ status: 'idle', message: null });
  // Depositor economics (item 10): accrued interest for the connected wallet.
  const [earnedYield, setEarnedYield] = useState(null); // ETH string | null until read
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
      // Item 10: accrued-but-unclaimed interest for this wallet (0 for wallets
      // that never deposited — the contract returns 0, not a revert).
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

  // Item 2: read tier limits/rates from the deployed contract so changing
  // contract parameters requires no UI change. Falls back to the constant map
  // only while the read is pending (or fails).
  useEffect(() => {
    const tier = credential && credential.credential ? credential.credential.tier : null;
    if (!tier) {
      setTierTerms(null);
      return;
    }
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
      } catch (e) {
        // keep fallback; the credential card still shows constructor defaults
      }
    })();
    return () => { cancelled = true; };
  }, [credential, getContract]);

  const handleLaunch = async () => {
    setLoading(true);
    setCredential(null);
    setBackendError(null);
    try {
      const res = await fetch('/api/credentials/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account || '' })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setBackendError(data.error || `Request failed: ${res.status}`);
        setCredential(null);
      } else {
        setCredential(data);
        setBackendError(null);
      }
    } catch (e) {
      setBackendError('Failed to connect to backend: ' + (e.message || e));
      setCredential(null);
    }
    setLoading(false);
  };

  const handleFaucet = async () => {
    if (!account) return;
    setFaucetState({ status: 'pending', message: 'Requesting 0.5 test ETH from the local faucet...' });
    try {
      const res = await fetch('/api/faucet/drip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account })
      });
      const data = await res.json();
      if (res.ok) {
        setFaucetState({ status: 'done', message: `${data.amount} ETH sent — new balance: ${data.balanceETH} ETH (tx: ${data.txHash})` });
      } else {
        setFaucetState({ status: 'failed', message: data.error || `Faucet failed: ${res.status}` });
      }
    } catch (e) {
      setFaucetState({ status: 'failed', message: 'Faucet unreachable: ' + (e.message || e) });
    }
  };

  const handleBorrow = async () => {
    if (!credential || !credential.credential || !credential.signature || !credential.tierHash) {
      setTxState({ status: 'failed', message: 'No valid credential available', hash: null });
      return;
    }
    if (!isLocalNetwork) {
      setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null });
      return;
    }
    if (loanState && loanState.borrower && loanState.borrower !== '0x0000000000000000000000000000000000000000' && !loanState.repaid) {
      setTxState({ status: 'failed', message: 'You already have an active loan. Repay it first, then borrow again — possibly with an upgraded tier.', hash: null });
      return;
    }
    if (credential.credential.userAddress !== account) {
      setTxState({ status: 'failed', message: 'Credential wallet does not match connected account', hash: null });
      return;
    }
    if (typeof credential.credential.issuedAt !== 'number') {
      setTxState({ status: 'failed', message: 'Stale credential missing issuedAt — refresh your credit credential', hash: null });
      return;
    }
    setTxState({ status: 'submitting', message: 'Submitting borrow transaction...', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const tier = credential.credential.tier;
      const userAddress = credential.credential.userAddress;
      const issuedAt = credential.credential.issuedAt;
      const tierHash = credential.tierHash;
      const sig = credential.signature;

      const tx = await contract.verifyAndIssueLoan(tier, userAddress, issuedAt, tierHash, sig);
      setTxState({ status: 'pending', message: 'Transaction pending...', hash: tx.hash });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        setTxState({ status: 'confirmed', message: 'Loan issued successfully', hash: tx.hash });
        await refreshOnChainData();
      } else {
        setTxState({ status: 'failed', message: 'Transaction failed', hash: tx.hash });
      }
    } catch (e) {
      setTxState({ status: 'failed', message: 'Borrow failed: ' + friendlyTxError(e), hash: null });
    }
  };

  const handleRepay = async () => {
    if (!loanState || !loanState.borrower || loanState.borrower === '0x0000000000000000000000000000000000000000' || loanState.repaid) {
      setTxState({ status: 'failed', message: 'No active loan to repay', hash: null });
      return;
    }
    if (!credential || !credential.tierHash) {
      setTxState({ status: 'failed', message: 'No credential available for repayment', hash: null });
      return;
    }
    if (!isLocalNetwork) {
      setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null });
      return;
    }
    setTxState({ status: 'submitting', message: 'Submitting repayment...', hash: null });
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      // Repayment must present the exact credential hash that issued the
      // active loan. Hashes embed issuedAt, so a re-issued credential would
      // no longer match — read the issuing hash from the loan itself instead.
      const loanRow = await contract.loans(account);
      const repaymentDue = loanRow.repaymentDue;
      const tierHash = loanRow.tierHash;
      if (!tierHash) {
        setTxState({ status: 'failed', message: 'Active loan has no issuing credential hash', hash: null });
        return;
      }
      const tx = await contract.repay(tierHash, { value: repaymentDue });
      setTxState({ status: 'pending', message: 'Repayment pending...', hash: tx.hash });
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        let repayMsg = 'Loan repaid successfully';
        let upgraded = false;
        try {
          // Ask the backend to verify the repay tx on-chain and record it in
          // the credit ledger (deduped by tx hash; trust is on-chain, not client input)
          const recRes = await fetch('/api/repayments/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
          } else if (recRes.ok && recData.alreadyRecorded) {
            repayMsg = 'Loan repaid successfully. Repayment was already recorded.';
          } else if (!recRes.ok && recData && recData.error) {
            repayMsg = `Loan repaid successfully (credit update pending: ${recData.error})`;
          }
        } catch (e) {
          repayMsg = 'Loan repaid successfully (credit update pending)';
        }
        setTxState({ status: 'confirmed', message: repayMsg, hash: tx.hash });
        await refreshOnChainData();
        if (upgraded) {
          // Refresh the credential card with updated evaluation stats/tier
          await handleLaunch();
        }
      } else {
        setTxState({ status: 'failed', message: 'Repayment transaction failed', hash: tx.hash });
      }
    } catch (e) {
      setTxState({ status: 'failed', message: 'Repayment failed: ' + friendlyTxError(e), hash: null });
    }
  };

  // Item 10: withdraw the connected wallet's accrued interest from the pool.
  const handleClaim = async () => {
    if (!account || !window.ethereum || claimBusy) return;
    if (!isLocalNetwork) {
      setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null });
      return;
    }
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
      } else {
        setTxState({ status: 'failed', message: 'Interest claim transaction failed', hash: tx.hash });
      }
    } catch (e) {
      setTxState({ status: 'failed', message: 'Interest claim failed: ' + friendlyTxError(e), hash: null });
    }
    setClaimBusy(false);
  };

  // Item 10 UI: deposit the connected wallet's ETH into the pool (LP position,
  // accrues a proportional share of future repayment interest).
  const handleDeposit = async () => {
    if (!account || !window.ethereum || depositBusy) return;
    if (!isLocalNetwork) {
      setTxState({ status: 'failed', message: 'Please connect to local Hardhat network', hash: null });
      return;
    }
    let amount;
    try {
      amount = parseEther(depositAmount);
    } catch (e) {
      setTxState({ status: 'failed', message: 'Deposit amount must be a valid ETH value (e.g. 0.1)', hash: null });
      return;
    }
    if (amount <= 0n) {
      setTxState({ status: 'failed', message: 'Deposit amount must be greater than zero', hash: null });
      return;
    }
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
        setTxState({
          status: 'confirmed',
          message: `Deposit confirmed — ${depositAmount} ETH added to your pool share; you now accrue interest on repayments.`,
          hash: tx.hash,
        });
        setDepositAmount('');
        await refreshOnChainData();
      } else {
        setTxState({ status: 'failed', message: 'Deposit transaction failed', hash: tx.hash });
      }
    } catch (e) {
      setTxState({ status: 'failed', message: 'Deposit failed: ' + friendlyTxError(e), hash: null });
    }
    setDepositBusy(false);
  };

  const tierInfo = (credential && credential.credential)
    ? (tierTerms || FALLBACK_TIER_MAP[credential.credential.tier] || null)
    : null;
  const tierTermsOnChain = !!tierTerms?.onChain;

  return (
    <main className="min-h-screen bg-[var(--color-canvas-dark)] text-[var(--color-body-dark)]">
      <nav className="h-16 px-6 flex items-center justify-between border-b border-[var(--color-hairline-dark)] bg-[var(--color-canvas-dark)]">
        <span className="text-2xl font-bold text-[var(--color-primary)] tracking-tight">CredPass</span>
        <div className="flex gap-6 text-sm font-medium">
          <a href="#flow" className="hover:text-[var(--color-primary)]">Features</a>
          <a href="#flow" className="hover:text-[var(--color-primary)]">How It Works</a>
        </div>
        <a href="#flow" className="px-4 py-2 rounded-md bg-[var(--color-primary)] text-[var(--color-ink)] font-semibold text-sm hover:bg-[var(--color-primary-active)]">Get Started</a>
        <div className="flex items-center gap-3 ml-4">
          {account ? (
            <>
              <span className="text-xs font-medium text-[var(--color-body-dark)] bg-[var(--color-surface-card-dark)] px-3 py-1.5 rounded-full border border-[var(--color-hairline-dark)]">{shortenedAddress}</span>
              <span className="text-xs text-[var(--color-muted-strong)]">{isLocalNetwork ? 'Local' : 'Wrong Network'}</span>
              {account && isLocalNetwork && (
                <button
                  onClick={handleFaucet}
                  disabled={faucetState.status === 'pending' || faucetState.status === 'done'}
                  title="Local-only test ETH faucet (0.5 ETH per drip)"
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
        </div>
      </nav>

      {faucetState.status !== 'idle' && faucetState.message && (
        <div className={`px-6 py-2 text-xs ${faucetState.status === 'failed' ? 'text-[var(--color-trading-down)]' : 'text-[var(--color-trading-up)]'}`}>
          {faucetState.message}
        </div>
      )}

      <section className="py-20 px-6 text-center">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-tight text-white mb-6">
          Prove Credit. <span className="text-[var(--color-primary)]">Keep Control.</span>
        </h1>
        <p className="text-lg text-[var(--color-muted-strong)] max-w-2xl mx-auto mb-10">
          CredPass is a privacy-first, wallet-linked credit passport powered by EIP-712 signed credentials.
        </p>

        {walletError && (
          <p className="mt-4 text-sm text-[var(--color-trading-down)] max-w-xl mx-auto">{walletError}</p>
        )}
        {!isLocalNetwork && account && (
          <div className="mt-4 max-w-xl mx-auto">
            <p className="text-sm text-[var(--color-trading-down)]">Connect to local Hardhat network (0x7a69) to interact with the contract.</p>
            <button onClick={switchToLocalNetwork} className="mt-3 px-5 py-2 rounded-full bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-card-dark)] text-sm font-semibold transition-colors">
              Switch to Hardhat Network
            </button>
          </div>
        )}

        <button onClick={handleLaunch} disabled={loading || !account} className="inline-block px-8 py-3 rounded-full bg-[var(--color-primary)] text-[var(--color-ink)] font-bold hover:bg-[var(--color-primary-active)] transition-colors disabled:opacity-50">
          {loading ? 'Signing...' : 'Get Credit Credential'}
        </button>
        {!account && (
          <p className="mt-4 text-sm text-[var(--color-muted-strong)]">Connect your wallet to issue a credential.</p>
        )}

        {backendError && (
          <p className="mt-4 text-sm text-[var(--color-trading-down)] max-w-xl mx-auto">{backendError}</p>
        )}

        {credential && (
          <div className="mt-6 bg-[var(--color-surface-card-dark)] rounded-xl p-6 max-w-xl mx-auto text-left text-sm text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)]">
            <h3 className="text-[var(--color-primary)] font-bold mb-2">Credential Issued</h3>
            <div className="space-y-1 mb-3">
              <div><strong>Tier:</strong> {credential.credential?.tier || 'Unknown'}</div>
              <div><strong>User Address:</strong> {credential.credential?.userAddress}</div>
              <div><strong>Tier Hash:</strong> <span className="font-mono text-xs break-all">{credential.tierHash}</span></div>
              <div><strong>Signer:</strong> <span className="font-mono text-xs">{credential.signer}</span></div>
              <div><strong>Evaluation:</strong> {credential.evaluation?.tier} tier · {credential.evaluation?.repaymentRecords || 0} records · ${credential.evaluation?.totalPaidUSD || 0}</div>
              {typeof credential.credential?.issuedAt === 'number' && (
                <div><strong>Issued:</strong> {new Date(credential.credential.issuedAt * 1000).toLocaleTimeString()} · expires 24h after issuance</div>
              )}
            </div>
            <div className="text-xs text-[var(--color-muted-strong)]">Signature and tier are authoritative from backend. Client does not control tier.</div>
          </div>
        )}

        {credential?.progress?.nextTier && (
          <div className="mt-6 bg-[var(--color-surface-card-dark)] rounded-xl p-6 max-w-xl mx-auto text-left text-sm text-[var(--color-body-dark)] border border-[var(--color-hairline-dark)]">
            <h3 className="text-[var(--color-primary)] font-bold mb-3">Progress toward Tier {credential.progress.nextTier}</h3>
            <ul className="space-y-2">
              {credential.progress.requirements.map((r, i) => {
                const pct = Math.min(100, Math.round(((Number(r.have) || 0) / r.need) * 100));
                return (
                  <li key={i}>
                    <div className="flex justify-between mb-1">
                      <span>{r.met ? '✓' : '○'} {r.label}</span>
                      <span className="font-mono text-xs">{r.unit}{r.have} / {r.unit}{r.need}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--color-surface-elevated-dark)] overflow-hidden">
                      <div className={`h-full rounded-full ${r.met ? 'bg-[var(--color-trading-up)]' : 'bg-[var(--color-primary)]'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 text-xs text-[var(--color-muted-strong)]">Repay loans on-chain to lift your tier — tiers only improve with verified repayments.</div>
          </div>
        )}
        {credential?.progress && !credential.progress.nextTier && (
          <div className="mt-6 max-w-xl mx-auto text-left text-sm text-[var(--color-trading-up)]">
            ✓ Top tier unlocked — no further credit requirements.
          </div>
        )}
      </section>

      {credential && tierInfo && (
        <section className="py-8 px-6 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-4">Loan Terms (From Contract)</h2>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="bg-[var(--color-surface-card-dark)] rounded-xl p-5 border border-[var(--color-hairline-dark)]">
              <div className="text-xs text-[var(--color-muted-strong)] mb-1">Tier</div>
              <div className="text-xl font-bold text-[var(--color-primary)]">{credential.credential.tier}</div>
            </div>
            <div className="bg-[var(--color-surface-card-dark)] rounded-xl p-5 border border-[var(--color-hairline-dark)]">
              <div className="text-xs text-[var(--color-muted-strong)] mb-1">Max Loan</div>
              <div className="text-xl font-bold text-white">{tierInfo.maxETH} ETH</div>
              <div className="text-[10px] mt-1 text-[var(--color-muted)]">{tierTermsOnChain ? 'read from contract' : 'fallback until contract read completes'}</div>
            </div>
            <div className="bg-[var(--color-surface-card-dark)] rounded-xl p-5 border border-[var(--color-hairline-dark)]">
              <div className="text-xs text-[var(--color-muted-strong)] mb-1">Fixed Rate</div>
              <div className="text-xl font-bold text-white">{tierInfo.ratePercent}%</div>
              <div className="text-[10px] mt-1 text-[var(--color-muted)]">{tierTermsOnChain ? 'read from contract' : 'fallback until contract read completes'}</div>
            </div>
          </div>
          <div className="bg-[var(--color-surface-card-dark)] rounded-xl p-5 border border-[var(--color-hairline-dark)] mb-6">
            <div className="flex justify-between mb-2"><span>Principal</span> <span className="font-mono">{tierInfo.maxETH} ETH</span></div>
            <div className="flex justify-between mb-2"><span>Fixed Interest</span> <span className="font-mono">{parseFloat(tierInfo.maxETH) * parseFloat(tierInfo.ratePercent) / 100} ETH</span></div>
            <div className="border-t border-[var(--color-hairline-dark)] pt-2 flex justify-between font-bold text-[var(--color-primary)]"><span>Total Repayment</span> <span className="font-mono">{(parseFloat(tierInfo.maxETH) * (1 + parseFloat(tierInfo.ratePercent) / 100)).toFixed(4)} ETH</span></div>
          </div>
          <p className="text-xs text-[var(--color-muted-strong)] mb-4">Borrowing depends on available pool liquidity and contract validation. Maximum limits are contract-enforced.</p>

          <div className="flex gap-3">
            {(() => {
              const hasActiveLoan = loanState && loanState.borrower && loanState.borrower !== '0x0000000000000000000000000000000000000000' && !loanState.repaid;
              const busy = txState.status === 'pending' || txState.status === 'submitting';
              return (
                <>
                  <button onClick={handleBorrow} disabled={!credential || !isLocalNetwork || hasActiveLoan || busy}
                    className="px-6 py-2.5 rounded-full bg-[var(--color-primary)] text-[var(--color-ink)] font-bold hover:bg-[var(--color-primary-active)] transition-colors disabled:opacity-50">
                    {hasActiveLoan ? 'Repay Loan First' : 'Borrow ETH'}
                  </button>
                  <button onClick={handleRepay} disabled={!loanState || !loanState.borrower || loanState.borrower === '0x0000000000000000000000000000000000000000' || loanState.repaid || !isLocalNetwork || busy} className="px-6 py-2.5 rounded-full bg-[var(--color-surface-elevated-dark)] text-[var(--color-body-dark)] font-bold border border-[var(--color-hairline-dark)] hover:bg-[var(--color-surface-card-dark)] transition-colors disabled:opacity-40">
                    Repay Loan
                  </button>
                </>
              );
            })()}
          </div>
        </section>
      )}

      {txState.status !== 'idle' && (
        <section className="py-4 px-6 max-w-3xl mx-auto">
          <div className={`rounded-xl p-5 border ${txState.status === 'confirmed' ? 'bg-[var(--color-trading-up)]/10 border-[var(--color-trading-up)]' : txState.status === 'failed' ? 'bg-[var(--color-trading-down)]/10 border-[var(--color-trading-down)]' : 'bg-[var(--color-surface-card-dark)] border-[var(--color-hairline-dark)]'}`}>
            <div className="font-bold mb-1">{txState.status === 'submitting' ? 'Submitting...' : txState.status === 'pending' ? 'Pending...' : txState.status === 'confirmed' ? 'Confirmed' : 'Failed'}</div>
            <div className="text-sm text-[var(--color-muted-strong)] mb-2">{txState.message}</div>
            {txState.hash && (
              <div className="text-xs font-mono break-all text-[var(--color-muted)]">Tx: {txState.hash}</div>
            )}
          </div>
        </section>
      )}

      <section className="py-8 px-6 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-4">Pool & Loan State (On-Chain)</h2>
        <div className="bg-[var(--color-surface-card-dark)] rounded-xl p-5 border border-[var(--color-hairline-dark)] space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-[var(--color-muted-strong)]">Pool Liquidity</span> <span className="font-mono font-bold">{poolLiquidity} ETH</span></div>
          <div className="flex justify-between"><span className="text-[var(--color-muted-strong)]">Borrower</span> <span className="font-mono">{loanState && loanState.borrower ? loanState.borrower : 'None'}</span></div>
          <div className="flex justify-between"><span className="text-[var(--color-muted-strong)]">Principal</span> <span className="font-mono">{loanState && loanState.principal ? loanState.principal + ' ETH' : '—'}</span></div>
          <div className="flex justify-between"><span className="text-[var(--color-muted-strong)]">Repayment Due</span> <span className="font-mono">{loanState && loanState.repaymentDue ? loanState.repaymentDue + ' ETH' : '—'}</span></div>
          <div className="flex justify-between"><span className="text-[var(--color-muted-strong)]">Tier</span> <span className="font-mono">{loanState && loanState.tier ? loanState.tier : '—'}</span></div>
          <div className="flex justify-between"><span className="text-[var(--color-muted-strong)]">Repaid</span> <span className="font-mono">{loanState ? (loanState.repaid ? 'Yes' : 'No') : '—'}</span></div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--color-muted-strong)]">Your Accrued Yield</span>
            <span className="flex items-center gap-3">
              <span className="font-mono font-bold">{earnedYield !== null ? earnedYield + ' ETH' : '—'}</span>
              <button
                onClick={handleClaim}
                disabled={!account || claimBusy || !earnedYield || parseFloat(earnedYield) <= 0}
                title={earnedYield !== null && parseFloat(earnedYield) > 0 ? 'Withdraw your accrued interest from the pool' : 'No accrued interest to claim'}
                className="px-3 py-1 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30 text-xs font-medium hover:bg-[var(--color-primary)]/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {claimBusy ? 'Claiming...' : 'Claim interest'}
              </button>
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--color-muted-strong)]">Deposit into Pool</span>
            <span className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                disabled={!account || depositBusy}
                className="w-24 rounded-lg bg-[var(--color-surface-elevated-dark)] border border-[var(--color-hairline-dark)] px-3 py-1 text-xs font-mono text-[var(--color-body-dark)] focus:outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
              />
              <button
                onClick={handleDeposit}
                disabled={!account || depositBusy || !depositAmount || parseFloat(depositAmount) <= 0 || isNaN(parseFloat(depositAmount))}
                title="Deposit ETH into the lending pool — you accrue a proportional share of repayment interest"
                className="px-3 py-1 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30 text-xs font-medium hover:bg-[var(--color-primary)]/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {depositBusy ? 'Depositing...' : 'Deposit'}
              </button>
            </span>
          </div>
          <p className="text-xs text-[var(--color-muted)]">Deposit first: only pool depositors accrue repayment interest (see contracts/DEPLOY_REF.md for the proportional split details).</p>
        </div>
        {contractError && <p className="text-sm text-[var(--color-trading-down)] mt-2">{contractError}</p>}
      </section>

      <section id="flow" className="text-center text-xs text-[var(--color-muted)] pb-4">Local Hardhat contract · EIP-712 credentials · No client-controlled tiers</section>
      <CredentialFlow />
    </main>
  );
}
