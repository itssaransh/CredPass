const net = require('net');
const req = JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788', data: '0x8da5cb5b' }, 'latest'], id: 1 });
const client = net.connect({ port: 8545, host: '127.0.0.1' }, () => {
  client.write('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ' + req.length + '\r\n\r\n' + req);
});
client.on('data', (data) => console.log(data.toString()));
client.on('end', () => client.end());
