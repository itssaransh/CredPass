export default function CredentialFlow() {
  const steps = [
    {
      num: '01',
      title: 'Connect Wallet',
      desc: 'Link MetaMask to the local Hardhat network (chainId 31337).',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>,
    },
    {
      num: '02',
      title: 'Request Evaluation',
      desc: 'Backend queries the SQL repayment ledger, calculates your credit tier, and issues an EIP-712 signed credential.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
    },
    {
      num: '03',
      title: 'Store Credential',
      desc: 'The signed credential is stored locally — your tier and wallet address travel with you, raw financial data stays private.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true"><rect x="2" y="7" width="20" height="13" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
    },
    {
      num: '04',
      title: 'Request Loan',
      desc: 'Pass your credential signature to the Lending Pool smart contract, which verifies it and unlocks undercollateralized terms.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    },
    {
      num: '05',
      title: 'Repay & Build Reputation',
      desc: 'On-chain repayments are verified by the backend and lift your credit tier over time — portable financial reputation.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    },
  ];

  return (
    <div className="relative overflow-hidden">
      <div className="relative z-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {steps.map((step, i) => (
          <div key={i} className="card-lift card animate-fade-in animate-slide-up group" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center" aria-hidden="true">
                {step.icon}
              </div>
              <span className="text-[10px] font-bold text-[var(--color-primary)] tracking-tighter uppercase">{step.num}</span>
            </div>
            <h4 className="text-sm font-bold text-white mb-2">{step.title}</h4>
            <p className="text-[11px] text-[var(--color-muted-strong)] leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
