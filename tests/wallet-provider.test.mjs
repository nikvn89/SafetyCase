import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/genlayer.ts', import.meta.url), 'utf8')
let pass = 0
let fail = 0
const check = (name, condition) => {
  if (condition) { pass += 1; console.log(`PASS  ${name}`) }
  else { fail += 1; console.error(`FAIL  ${name}`) }
}

check('no wallet_getSnaps', !source.includes('wallet_getSnaps'))
check('no wallet_requestSnaps', !source.includes('wallet_requestSnaps'))
check("no client.connect('studionet')", !/\.connect\s*\(\s*['\"]studionet['\"]\s*\)/.test(source))
check('uses eth_requestAccounts', source.includes("method: 'eth_requestAccounts'"))
check('uses eth_chainId', source.includes("method: 'eth_chainId'"))
check('handles wallet_switchEthereumChain', source.includes("method: 'wallet_switchEthereumChain'"))
check('handles wallet_addEthereumChain', source.includes("method: 'wallet_addEthereumChain'"))
check('wallet provider passed to write client', source.includes('provider: window.ethereum'))
check('RPC-level concurrent write guard present', source.includes('rpcWriteInFlight'))

console.log(`\nTOTAL: ${pass + fail} checks, ${fail} failed`)
process.exit(fail ? 1 : 0)
