import { Wallet } from 'ethers';
const w = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
console.log('Address from .env key:', w.address);
