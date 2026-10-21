import { useState, useEffect, useCallback } from 'react';

const LOCAL_HARDHAT_CHAIN_ID = '0x7a69';

// MetaMask-ready params for the local Hardhat node (matches hardhat.config.cjs)
const LOCAL_NETWORK_PARAMS = {
  chainId: LOCAL_HARDHAT_CHAIN_ID,
  chainName: 'Hardhat Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['http://127.0.0.1:8545/'],
};

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error, setError] = useState(null);
  const [isLocalNetwork, setIsLocalNetwork] = useState(false);

  const checkMetaMask = useCallback(() => {
    if (!window.ethereum) {
      setError('MetaMask not detected');
      return false;
    }
    setError(null);
    return true;
  }, []);

  const connectWallet = useCallback(async () => {
    setError(null);
    if (!checkMetaMask()) return;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0]);
      }
    } catch (err) {
      if (err.code === 4001) {
        setError('Connection rejected by user');
      } else {
        setError('Failed to connect wallet: ' + (err.message || err));
      }
    }
  }, [checkMetaMask]);

  const disconnectWallet = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setIsLocalNetwork(false);
  }, []);

  // Ask MetaMask to switch to the local Hardhat network; the 0x7a69 chain is
  // added on demand (MetaMask returns 4902/-32603 when the chain is unknown).
  const switchToLocalNetwork = useCallback(async () => {
    if (!checkMetaMask()) return false;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: LOCAL_HARDHAT_CHAIN_ID }],
      });
      setError(null);
      return true;
    } catch (err) {
      if (err.code === 4902 || err.code === -32603) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [LOCAL_NETWORK_PARAMS],
          });
          setError(null);
          return true;
        } catch (addErr) {
          if (addErr.code !== 4001) {
            setError('Failed to add Hardhat network: ' + (addErr.message || addErr));
          }
          return false;
        }
      }
      if (err.code === 4001) {
        setError('Network switch rejected by user');
      } else {
        setError('Failed to switch network: ' + (err.message || err));
      }
      return false;
    }
  }, [checkMetaMask]);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAccount(null);
      } else {
        setAccount(accounts[0]);
      }
    };

    const handleChainChanged = (chain) => {
      setChainId(chain);
      if (chain === LOCAL_HARDHAT_CHAIN_ID) {
        setIsLocalNetwork(true);
        setError(null);
      } else {
        setIsLocalNetwork(false);
        setError('Please connect to the local Hardhat network (chainId 0x7a69)');
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    window.ethereum.request({ method: 'eth_accounts' }).then((accounts) => {
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0]);
      }
      window.ethereum.request({ method: 'eth_chainId' }).then((id) => {
        setChainId(id);
        setIsLocalNetwork(id === LOCAL_HARDHAT_CHAIN_ID);
        if (id !== LOCAL_HARDHAT_CHAIN_ID) {
          setError('Please connect to the local Hardhat network (chainId 0x7a69)');
        } else {
          setError(null);
        }
      }).catch(() => {});
    }).catch(() => {});

    return () => {
      if (window.ethereum && window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  const shortenedAddress = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : null;

  return {
    account,
    chainId,
    error,
    connectWallet,
    disconnectWallet,
    switchToLocalNetwork,
    shortenedAddress,
    hasMetaMask: !!window.ethereum,
    isLocalNetwork,
  };
}
